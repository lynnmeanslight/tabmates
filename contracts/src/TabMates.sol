// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title TabMates — a shared-expenses ledger with onchain settlement
/// @notice Log who paid for what in a group (roommates, trips, friends),
///         keep pairwise debts netted automatically, and settle up by
///         actually sending MON — not by marking a checkbox. Members carry
///         human-readable names so the ledger reads like a fridge note,
///         not a block explorer.
/// @dev    No custody: settlement value is forwarded to the creditor in the
///         same transaction. The contract never holds funds.
contract TabMates {
    // ---------------------------------------------------------------- types

    struct Group {
        string name;
        address creator;
        uint64 createdAt;
        address[] members;
    }

    struct Expense {
        address payer;
        uint256 amount; // total paid, in wei
        uint64 timestamp;
        string memo;
        address[] participants; // who shares this expense (may include payer)
    }

    struct Settlement {
        address from;
        address to;
        uint256 amount; // wei actually transferred
        uint64 timestamp;
    }

    // --------------------------------------------------------------- errors

    error NotAMember();
    error AlreadyMember();
    error ZeroAmount();
    error AmountTooLarge();
    error ZeroAddress();
    error EmptyName();
    error MemoTooLong();
    error NameTooLong();
    error LabelTooLong();
    error LengthMismatch();
    error TooManyMembers();
    error NoParticipants();
    error DuplicateParticipant();
    error NothingOwed();
    error PayingTooMuch();
    error SelfSettle();
    error TransferFailed();
    error UnknownGroup();
    error Reentrancy();

    // --------------------------------------------------------------- events

    event GroupCreated(uint256 indexed groupId, string name, address indexed creator);
    event MemberAdded(uint256 indexed groupId, address indexed member, address indexed addedBy);
    event MemberNamed(uint256 indexed groupId, address indexed member, string name, address indexed namedBy);
    event ExpenseAdded(
        uint256 indexed groupId,
        uint256 indexed expenseId,
        address indexed payer,
        uint256 amount,
        string memo
    );
    event Settled(uint256 indexed groupId, address indexed from, address indexed to, uint256 amount);

    // -------------------------------------------------------------- storage

    uint256 public constant MAX_MEMBERS = 32;
    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_MEMO_BYTES = 140;
    uint256 public constant MAX_LABEL_BYTES = 32;

    /// @dev Cap on a single expense (~3.4e20 MON — far above total supply).
    ///      Keeps every debt edge far below int256 range so `netBalance` and
    ///      debt accumulation can never overflow or silently wrap.
    uint256 public constant MAX_AMOUNT = type(uint128).max;

    uint256 public groupCount;

    mapping(uint256 => Group) private _groups;
    mapping(uint256 => Expense[]) private _expenses;
    mapping(uint256 => Settlement[]) private _settlements;

    /// @notice debt[groupId][debtor][creditor] = wei that `debtor` owes `creditor`.
    /// @dev    Invariant: for any pair (a,b) at most one of debt[a][b], debt[b][a] is non-zero.
    mapping(uint256 => mapping(address => mapping(address => uint256))) public debt;

    mapping(uint256 => mapping(address => bool)) public isMember;

    /// @notice memberName[groupId][member] — human label shown instead of the
    ///         address ("Maya", "Sam from 4B"). Set by whoever adds the member,
    ///         editable by any member of the group (tabs are trust-scoped).
    mapping(uint256 => mapping(address => string)) public memberName;

    /// @notice Every group id an address belongs to (for indexer-free frontends).
    mapping(address => uint256[]) private _memberGroups;

    uint256 private _entered = 1;

    modifier nonReentrant() {
        if (_entered != 1) revert Reentrancy();
        _entered = 2;
        _;
        _entered = 1;
    }

    modifier onlyMember(uint256 groupId) {
        if (groupId >= groupCount) revert UnknownGroup();
        if (!isMember[groupId][msg.sender]) revert NotAMember();
        _;
    }

    // ------------------------------------------------------------- mutators

    /// @notice Start a new tab. Caller becomes a member automatically.
    /// @param name         Display name, e.g. "Flat 4B" (≤ 64 bytes).
    /// @param yourName     Your own label, e.g. "Lynn" (≤ 32 bytes, may be "").
    /// @param members      Other members to add right away (can be empty).
    /// @param memberNames  A label per member, aligned with `members` ("" allowed).
    function createGroup(
        string calldata name,
        string calldata yourName,
        address[] calldata members,
        string[] calldata memberNames
    ) external returns (uint256 groupId) {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(name).length > MAX_NAME_BYTES) revert NameTooLong();
        if (members.length != memberNames.length) revert LengthMismatch();
        if (members.length + 1 > MAX_MEMBERS) revert TooManyMembers();

        groupId = groupCount++;
        Group storage g = _groups[groupId];
        g.name = name;
        g.creator = msg.sender;
        g.createdAt = uint64(block.timestamp);

        _addMember(groupId, msg.sender, yourName, msg.sender);
        for (uint256 i = 0; i < members.length; i++) {
            _addMember(groupId, members[i], memberNames[i], msg.sender);
        }

        emit GroupCreated(groupId, name, msg.sender);
    }

    /// @notice Add a member (with an optional label) to a tab. Any existing
    ///         member may add people — tabs are for people who already trust
    ///         each other.
    function addMember(uint256 groupId, address member, string calldata name)
        external
        onlyMember(groupId)
    {
        if (_groups[groupId].members.length + 1 > MAX_MEMBERS) revert TooManyMembers();
        _addMember(groupId, member, name, msg.sender);
    }

    /// @notice Set or fix the label of any member in a tab you belong to
    ///         (rename yourself, or the roommate who typed their own name as
    ///         "asdf"). Empty string clears the label.
    function setMemberName(uint256 groupId, address member, string calldata name)
        external
        onlyMember(groupId)
    {
        if (!isMember[groupId][member]) revert NotAMember();
        if (bytes(name).length > MAX_LABEL_BYTES) revert LabelTooLong();
        memberName[groupId][member] = name;
        emit MemberNamed(groupId, member, name, msg.sender);
    }

    function _addMember(uint256 groupId, address member, string calldata name, address addedBy)
        private
    {
        if (member == address(0)) revert ZeroAddress();
        if (isMember[groupId][member]) revert AlreadyMember();
        if (bytes(name).length > MAX_LABEL_BYTES) revert LabelTooLong();
        isMember[groupId][member] = true;
        _groups[groupId].members.push(member);
        _memberGroups[member].push(groupId);
        emit MemberAdded(groupId, member, addedBy);
        if (bytes(name).length != 0) {
            memberName[groupId][member] = name;
            emit MemberNamed(groupId, member, name, addedBy);
        }
    }

    /// @notice Record an expense you paid, split equally among `participants`.
    /// @dev    Each participant other than the payer owes `amount / participants.length`.
    ///         Integer-division dust (< participants.length wei) is absorbed by
    ///         the payer, which at MON prices is comfortably nothing.
    /// @param groupId       The tab.
    /// @param memo          What it was, e.g. "Groceries" (≤ 140 bytes).
    /// @param amount        Total paid, in wei.
    /// @param participants  Everyone who shares the expense. May include the
    ///                      payer. Must be members, no duplicates.
    function addExpense(
        uint256 groupId,
        string calldata memo,
        uint256 amount,
        address[] calldata participants
    ) external onlyMember(groupId) returns (uint256 expenseId) {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_AMOUNT) revert AmountTooLarge();
        if (bytes(memo).length > MAX_MEMO_BYTES) revert MemoTooLong();
        uint256 n = participants.length;
        if (n == 0) revert NoParticipants();

        // validate: members only, no duplicates (n ≤ 32 so O(n²) is fine)
        for (uint256 i = 0; i < n; i++) {
            if (!isMember[groupId][participants[i]]) revert NotAMember();
            for (uint256 j = i + 1; j < n; j++) {
                if (participants[i] == participants[j]) revert DuplicateParticipant();
            }
        }

        uint256 share = amount / n;
        if (share == 0) revert ZeroAmount(); // amount too small to split

        for (uint256 i = 0; i < n; i++) {
            address p = participants[i];
            if (p == msg.sender) continue; // payer's own share isn't a debt
            _addDebt(groupId, p, msg.sender, share);
        }

        expenseId = _expenses[groupId].length;
        _expenses[groupId].push(
            Expense({
                payer: msg.sender,
                amount: amount,
                timestamp: uint64(block.timestamp),
                memo: memo,
                participants: participants
            })
        );

        emit ExpenseAdded(groupId, expenseId, msg.sender, amount, memo);
    }

    /// @dev Add `amount` to what `debtor` owes `creditor`, netting against any
    ///      debt in the opposite direction first, so at most one direction of
    ///      a pair is ever non-zero.
    function _addDebt(uint256 groupId, address debtor, address creditor, uint256 amount) private {
        uint256 reverse = debt[groupId][creditor][debtor];
        if (reverse >= amount) {
            unchecked {
                debt[groupId][creditor][debtor] = reverse - amount;
            }
        } else {
            debt[groupId][creditor][debtor] = 0;
            unchecked {
                amount -= reverse; // safe: reverse < amount in this branch
            }
            debt[groupId][debtor][creditor] += amount; // checked add: never wraps
        }
    }

    /// @notice Pay down what you owe `creditor` in this tab — with real MON.
    ///         Send any amount up to your outstanding debt (partial payments ok).
    ///         The value is forwarded straight to the creditor.
    function settle(uint256 groupId, address creditor)
        external
        payable
        nonReentrant
        onlyMember(groupId)
    {
        if (creditor == msg.sender) revert SelfSettle();
        if (!isMember[groupId][creditor]) revert NotAMember();
        if (msg.value == 0) revert ZeroAmount();

        uint256 owed = debt[groupId][msg.sender][creditor];
        if (owed == 0) revert NothingOwed();
        if (msg.value > owed) revert PayingTooMuch();

        unchecked {
            debt[groupId][msg.sender][creditor] = owed - msg.value;
        }

        _settlements[groupId].push(
            Settlement({
                from: msg.sender,
                to: creditor,
                amount: msg.value,
                timestamp: uint64(block.timestamp)
            })
        );

        (bool ok,) = creditor.call{value: msg.value}("");
        if (!ok) revert TransferFailed();

        emit Settled(groupId, msg.sender, creditor, msg.value);
    }

    // ---------------------------------------------------------------- views

    function getGroup(uint256 groupId)
        external
        view
        returns (
            string memory name,
            address creator,
            uint64 createdAt,
            address[] memory members,
            string[] memory memberNames
        )
    {
        if (groupId >= groupCount) revert UnknownGroup();
        Group storage g = _groups[groupId];
        uint256 n = g.members.length;
        memberNames = new string[](n);
        for (uint256 i = 0; i < n; i++) {
            memberNames[i] = memberName[groupId][g.members[i]];
        }
        return (g.name, g.creator, g.createdAt, g.members, memberNames);
    }

    /// @notice All group ids `account` belongs to.
    function groupsOf(address account) external view returns (uint256[] memory) {
        return _memberGroups[account];
    }

    function expenseCount(uint256 groupId) external view returns (uint256) {
        return _expenses[groupId].length;
    }

    function settlementCount(uint256 groupId) external view returns (uint256) {
        return _settlements[groupId].length;
    }

    /// @notice Ranged expense reader (newest are at the end).
    function getExpenses(uint256 groupId, uint256 start, uint256 count)
        external
        view
        returns (Expense[] memory page)
    {
        Expense[] storage all = _expenses[groupId];
        uint256 len = all.length;
        if (start >= len) return new Expense[](0);
        uint256 end = start + count;
        if (end > len) end = len;
        page = new Expense[](end - start);
        for (uint256 i = start; i < end; i++) {
            page[i - start] = all[i];
        }
    }

    /// @notice Ranged settlement reader (newest are at the end).
    function getSettlements(uint256 groupId, uint256 start, uint256 count)
        external
        view
        returns (Settlement[] memory page)
    {
        Settlement[] storage all = _settlements[groupId];
        uint256 len = all.length;
        if (start >= len) return new Settlement[](0);
        uint256 end = start + count;
        if (end > len) end = len;
        page = new Settlement[](end - start);
        for (uint256 i = start; i < end; i++) {
            page[i - start] = all[i];
        }
    }

    /// @notice Every non-zero debt edge in the group.
    function getAllDebts(uint256 groupId)
        external
        view
        returns (address[] memory debtors, address[] memory creditors, uint256[] memory amounts)
    {
        if (groupId >= groupCount) revert UnknownGroup();
        address[] storage m = _groups[groupId].members;
        uint256 n = m.length;

        uint256 edges;
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = 0; j < n; j++) {
                if (i != j && debt[groupId][m[i]][m[j]] != 0) edges++;
            }
        }

        debtors = new address[](edges);
        creditors = new address[](edges);
        amounts = new uint256[](edges);
        uint256 k;
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = 0; j < n; j++) {
                if (i == j) continue;
                uint256 a = debt[groupId][m[i]][m[j]];
                if (a != 0) {
                    debtors[k] = m[i];
                    creditors[k] = m[j];
                    amounts[k] = a;
                    k++;
                }
            }
        }
    }

    /// @notice Net position of `account` in a group.
    ///         Positive: others owe them. Negative: they owe others.
    function netBalance(uint256 groupId, address account) external view returns (int256 net) {
        if (groupId >= groupCount) revert UnknownGroup();
        address[] storage m = _groups[groupId].members;
        for (uint256 i = 0; i < m.length; i++) {
            address other = m[i];
            if (other == account) continue;
            net += int256(debt[groupId][other][account]); // owed to me
            net -= int256(debt[groupId][account][other]); // I owe
        }
    }
}
