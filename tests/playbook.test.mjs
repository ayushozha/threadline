import test from "node:test";
import assert from "node:assert/strict";
import { isDecisionTalk, stabilizer, playbookFor, prioritize, pushLater, pushedTasks, takeBack, undoPush, addDays } from "../app/static/playbook.js";

const today = "2026-11-14";
const mk = () => [
  { id: "a", title: "Tax form", due: "2026-11-13" },
  { id: "b", title: "Quit job?", due: null, big: true },
  { id: "c", title: "Reply to Sam", due: "2026-11-14" },
  { id: "d", title: "Plan trip", due: "2026-11-30" },
  { id: "e", title: "Done thing", due: today, done: true },
];

test("decision talk is detected; ordinary talk is not", () => {
  assert.ok(isDecisionTalk("I'm going to quit my job tomorrow"));
  assert.ok(isDecisionTalk("Should I sign the lease?"));
  assert.ok(!isDecisionTalk("I went for a walk and it was nice"));
});

test("stabilizer needs two matching readings", () => {
  const s = stabilizer(2);
  assert.equal(s.push("low"), null);
  assert.equal(s.push("steady"), null);       // flapped, restart
  assert.equal(s.push("low"), null);
  assert.deepEqual(s.push("low"), { from: "unknown", to: "low" });
  assert.equal(s.push("low"), null);
});

test("playbooks follow transitions", () => {
  assert.equal(playbookFor({ from: "steady", to: "low" }), "low");
  assert.equal(playbookFor({ from: "steady", to: "moody" }), "moody");
  assert.equal(playbookFor({ from: "low", to: "positive" }), "recover");
  assert.equal(playbookFor({ from: "unknown", to: "steady" }), null);
});

test("low energy keeps one task and parks the big decision", () => {
  const { focus, later } = prioritize(mk(), { today, energy: "low" });
  assert.deepEqual(focus.map((t) => t.id), ["a"]);           // overdue first
  assert.ok(later.some((t) => t.id === "b"));
  assert.ok(!later.some((t) => t.id === "e"));               // done tasks ignored
});

test("positive energy allows three and big decisions rank normally", () => {
  const { focus } = prioritize(mk(), { today, energy: "positive" });
  assert.equal(focus.length, 3);
});

test("push later records origin, take back restores to today, undo restores exactly", () => {
  const tasks = mk();
  assert.equal(pushLater(tasks, ["c", "d", "b"], { today, days: 2 }), 3);
  assert.equal(tasks[2].heldUntil, "2026-11-16");
  assert.equal(pushedTasks(tasks).length, 3);
  assert.equal(pushLater(tasks, ["c"], { today }), 0);       // already parked
  assert.equal(takeBack(tasks, ["a", "c"], { today }), 1);   // 'a' was never pushed
  assert.equal(tasks[2].heldUntil, null);
  assert.equal(undoPush(tasks, ["d"]), 1);
  assert.equal(tasks[3].due, "2026-11-30");
  assert.equal(tasks[3].pushed, undefined);
});

test("addDays crosses month ends", () => assert.equal(addDays("2026-11-30", 2), "2026-12-02"));
