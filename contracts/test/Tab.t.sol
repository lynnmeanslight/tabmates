// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Tab} from "../src/Tab.sol";

contract TabTest is Test {
    Tab tab;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address cara = makeAddr("cara");
    address mallory = makeAddr("mallory");

    function setUp() public {
        tab = new Tab();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(cara, 100 ether);
        vm.deal(mallory, 100 ether);
    }

    function _newGroup() internal returns (uint256 id) {
        address[] memory others = new address[](2);
        others[0] = bob;
        others[1] = cara;
        vm.prank(alice);
        id = tab.createGroup("Flat 4B", others);
    }

    // ------------------------------------------------------------ creation

    function test_createGroup() public {
        uint256 id = _newGroup();
        (string memory name, address creator,, address[] memory members) = tab.getGroup(id);
        assertEq(name, "Flat 4B");
        assertEq(creator, alice);
        assertEq(members.length, 3);
        assertTrue(tab.isMember(id, alice));
        assertTrue(tab.isMember(id, bob));
        assertTrue(tab.isMember(id, cara));
        assertEq(tab.groupsOf(bob).length, 1);
        assertEq(tab.groupsOf(bob)[0], id);
    }

    function test_createGroup_rejectsEmptyName() public {
        address[] memory none = new address[](0);
        vm.expectRevert(Tab.EmptyName.selector);
        tab.createGroup("", none);
    }

    function test_addMember_onlyMembers() public {
        uint256 id = _newGroup();
        vm.prank(mallory);
        vm.expectRevert(Tab.NotAMember.selector);
        tab.addMember(id, mallory);

        vm.prank(bob);
        tab.addMember(id, mallory);
        assertTrue(tab.isMember(id, mallory));
    }

    function test_addMember_rejectsDuplicates() public {
        uint256 id = _newGroup();
        vm.prank(alice);
        vm.expectRevert(Tab.AlreadyMember.selector);
        tab.addMember(id, bob);
    }

    // ------------------------------------------------------------ expenses

    function test_expenseSplitsEqually() public {
        uint256 id = _newGroup();
        address[] memory everyone = new address[](3);
        everyone[0] = alice;
        everyone[1] = bob;
        everyone[2] = cara;

        vm.prank(alice);
        tab.addExpense(id, "Groceries", 3 ether, everyone);

        assertEq(tab.debt(id, bob, alice), 1 ether);
        assertEq(tab.debt(id, cara, alice), 1 ether);
        assertEq(tab.debt(id, alice, bob), 0);
        assertEq(tab.netBalance(id, alice), 2 ether);
        assertEq(tab.netBalance(id, bob), -1 ether);
    }

    function test_expenseWithoutPayerInParticipants() public {
        uint256 id = _newGroup();
        address[] memory justBobCara = new address[](2);
        justBobCara[0] = bob;
        justBobCara[1] = cara;

        // alice fronts 2 MON for something only bob & cara use
        vm.prank(alice);
        tab.addExpense(id, "Their takeout", 2 ether, justBobCara);

        assertEq(tab.debt(id, bob, alice), 1 ether);
        assertEq(tab.debt(id, cara, alice), 1 ether);
    }

    function test_debtsNetAutomatically() public {
        uint256 id = _newGroup();
        address[] memory ab = new address[](2);
        ab[0] = alice;
        ab[1] = bob;

        vm.prank(alice);
        tab.addExpense(id, "Dinner", 2 ether, ab); // bob owes alice 1

        vm.prank(bob);
        tab.addExpense(id, "Cab", 1 ether, ab); // alice owes bob 0.5 -> nets

        assertEq(tab.debt(id, bob, alice), 0.5 ether);
        assertEq(tab.debt(id, alice, bob), 0); // never both directions
    }

    function test_expenseValidation() public {
        uint256 id = _newGroup();
        address[] memory ps = new address[](1);
        ps[0] = bob;

        vm.prank(mallory);
        vm.expectRevert(Tab.NotAMember.selector);
        tab.addExpense(id, "x", 1 ether, ps);

        vm.prank(alice);
        vm.expectRevert(Tab.ZeroAmount.selector);
        tab.addExpense(id, "x", 0, ps);

        address[] memory dup = new address[](2);
        dup[0] = bob;
        dup[1] = bob;
        vm.prank(alice);
        vm.expectRevert(Tab.DuplicateParticipant.selector);
        tab.addExpense(id, "x", 1 ether, dup);

        address[] memory withOutsider = new address[](2);
        withOutsider[0] = bob;
        withOutsider[1] = mallory;
        vm.prank(alice);
        vm.expectRevert(Tab.NotAMember.selector);
        tab.addExpense(id, "x", 1 ether, withOutsider);
    }

    // ---------------------------------------------------------- settlement

    function test_settleTransfersRealValue() public {
        uint256 id = _newGroup();
        address[] memory ab = new address[](2);
        ab[0] = alice;
        ab[1] = bob;

        vm.prank(alice);
        tab.addExpense(id, "Rent", 4 ether, ab); // bob owes alice 2

        uint256 aliceBefore = alice.balance;

        vm.prank(bob);
        tab.settle{value: 2 ether}(id, alice);

        assertEq(alice.balance, aliceBefore + 2 ether, "creditor got paid");
        assertEq(tab.debt(id, bob, alice), 0, "debt cleared");
        assertEq(address(tab).balance, 0, "contract holds nothing");
        assertEq(tab.settlementCount(id), 1);
    }

    function test_settlePartial() public {
        uint256 id = _newGroup();
        address[] memory ab = new address[](2);
        ab[0] = alice;
        ab[1] = bob;

        vm.prank(alice);
        tab.addExpense(id, "Rent", 4 ether, ab); // bob owes 2

        vm.prank(bob);
        tab.settle{value: 0.75 ether}(id, alice);
        assertEq(tab.debt(id, bob, alice), 1.25 ether);
    }

    function test_settleGuards() public {
        uint256 id = _newGroup();
        address[] memory ab = new address[](2);
        ab[0] = alice;
        ab[1] = bob;
        vm.prank(alice);
        tab.addExpense(id, "Rent", 4 ether, ab); // bob owes 2

        vm.prank(bob);
        vm.expectRevert(Tab.PayingTooMuch.selector);
        tab.settle{value: 3 ether}(id, alice);

        vm.prank(cara);
        vm.expectRevert(Tab.NothingOwed.selector);
        tab.settle{value: 1 ether}(id, alice);

        vm.prank(bob);
        vm.expectRevert(Tab.SelfSettle.selector);
        tab.settle{value: 1 ether}(id, bob);

        vm.prank(mallory);
        vm.expectRevert(Tab.NotAMember.selector);
        tab.settle{value: 1 ether}(id, alice);
    }

    // --------------------------------------------------------------- views

    function test_feedAndDebtViews() public {
        uint256 id = _newGroup();
        address[] memory everyone = new address[](3);
        everyone[0] = alice;
        everyone[1] = bob;
        everyone[2] = cara;

        vm.prank(alice);
        tab.addExpense(id, "Groceries", 3 ether, everyone);
        vm.prank(bob);
        tab.addExpense(id, "Internet", 1.5 ether, everyone);

        assertEq(tab.expenseCount(id), 2);
        Tab.Expense[] memory page = tab.getExpenses(id, 0, 10);
        assertEq(page.length, 2);
        assertEq(page[0].memo, "Groceries");
        assertEq(page[1].payer, bob);
        assertEq(page[1].participants.length, 3);

        (address[] memory debtors, address[] memory creditors, uint256[] memory amounts) =
            tab.getAllDebts(id);
        assertEq(debtors.length, 3); // bob->alice 0.5 (netted), cara->alice 1, cara->bob 0.5
        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) total += amounts[i];
        assertEq(total, 2 ether);
        assertEq(creditors.length, debtors.length);
    }

    function test_dustAbsorbedByPayer() public {
        uint256 id = _newGroup();
        address[] memory everyone = new address[](3);
        everyone[0] = alice;
        everyone[1] = bob;
        everyone[2] = cara;

        vm.prank(alice);
        tab.addExpense(id, "Odd amount", 100, everyone); // 100 / 3 = 33

        assertEq(tab.debt(id, bob, alice), 33);
        assertEq(tab.debt(id, cara, alice), 33);
    }
}
