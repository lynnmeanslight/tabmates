import { parseAbi } from "viem";

/** TabMates v3 (audited), deployed on Monad Mainnet (chain id 143). */
export const TAB_ADDRESS = "0xc294C7E608F79e9FfCF4eDB85e36A91E4CCBAdB9" as const;

export const tabAbi = parseAbi([
  "struct Expense { address payer; uint256 amount; uint64 timestamp; string memo; address[] participants; }",
  "struct Settlement { address from; address to; uint256 amount; uint64 timestamp; }",
  "function createGroup(string name, string yourName, address[] members, string[] memberNames) returns (uint256)",
  "function addMember(uint256 groupId, address member, string name)",
  "function setMemberName(uint256 groupId, address member, string name)",
  "function addExpense(uint256 groupId, string memo, uint256 amount, address[] participants) returns (uint256)",
  "function settle(uint256 groupId, address creditor) payable",
  "function groupCount() view returns (uint256)",
  "function getGroup(uint256 groupId) view returns (string name, address creator, uint64 createdAt, address[] members, string[] memberNames)",
  "function groupsOf(address account) view returns (uint256[])",
  "function memberName(uint256 groupId, address member) view returns (string)",
  "function expenseCount(uint256 groupId) view returns (uint256)",
  "function settlementCount(uint256 groupId) view returns (uint256)",
  "function getExpenses(uint256 groupId, uint256 start, uint256 count) view returns (Expense[])",
  "function getSettlements(uint256 groupId, uint256 start, uint256 count) view returns (Settlement[])",
  "function getAllDebts(uint256 groupId) view returns (address[] debtors, address[] creditors, uint256[] amounts)",
  "function netBalance(uint256 groupId, address account) view returns (int256)",
  "function debt(uint256 groupId, address debtor, address creditor) view returns (uint256)",
  "event GroupCreated(uint256 indexed groupId, string name, address indexed creator)",
  "event MemberAdded(uint256 indexed groupId, address indexed member, address indexed addedBy)",
  "event MemberNamed(uint256 indexed groupId, address indexed member, string name, address indexed namedBy)",
  "event ExpenseAdded(uint256 indexed groupId, uint256 indexed expenseId, address indexed payer, uint256 amount, string memo)",
  "event Settled(uint256 indexed groupId, address indexed from, address indexed to, uint256 amount)",
]);

export const EXPLORER = "https://monadvision.com";
