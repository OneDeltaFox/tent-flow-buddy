import { expect, test } from "@playwright/test";
import { emptyPod, initialPods, numberPodBeds } from "../src/lib/tent-data";

test("bed numbering migrates labels without changing patients or references", () => {
  const legacy = initialPods.map(({ number: _number, ...pod }) => ({
    ...pod,
    beds: pod.beds.map((bed) => ({ ...bed, label: bed.id })),
  }));
  const migrated = numberPodBeds(legacy);
  expect(migrated[0].beds.map((bed) => bed.label)).toEqual(["1-1", "1-2", "1-3", "1-4"]);
  for (let index = 0; index < legacy.length; index++) {
    expect(migrated[index].id).toBe(legacy[index].id);
    expect(migrated[index].beds.map(({ label: _label, ...bed }) => bed)).toEqual(
      legacy[index].beds.map(({ label: _label, ...bed }) => bed),
    );
  }
  const afterRemovalAndReload = numberPodBeds(JSON.parse(JSON.stringify(migrated.slice(1))));
  expect(afterRemovalAndReload[0].beds[0].label).toBe("2-1");
});

test("numbered pod names and new pods use their own number", () => {
  const { number: _number, ...legacy } = initialPods[0];
  const migrated = numberPodBeds([{ ...legacy, name: "Pod 12 - Cooling" }]);
  expect(migrated[0].beds[0].label).toBe("12-1");
  const newPod = emptyPod("G", "Pod 13", "Finish", "", "#06b6d4", 13);
  expect(newPod.beds.map((bed) => bed.label)).toEqual(["13-1", "13-2", "13-3", "13-4"]);
  expect(newPod.beds[0].id).toBe("G1");
});
