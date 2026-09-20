/**
 * Lightweight regression checks for map gesture restore.
 * Run: npx tsx src/lib/mapInteractions.test.ts
 */
import {
  MAP_GESTURE_HANDLER_NAMES,
  releaseCapturedPointer,
  restoreMapInteractions,
  suspendMapInteractions,
  type MapGestureMap,
} from './mapInteractions.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function makeHandler() {
  let enabled = true;
  let resets = 0;
  let enables = 0;
  let disables = 0;
  return {
    stats: () => ({ enabled, resets, enables, disables }),
    handler: {
      isEnabled: () => enabled,
      enable: () => {
        enabled = true;
        enables += 1;
      },
      disable: () => {
        enabled = false;
        disables += 1;
      },
      reset: () => {
        resets += 1;
      },
    },
  };
}

function testRestoreBouncesEnabledHandlers() {
  const handlers = Object.fromEntries(
    MAP_GESTURE_HANDLER_NAMES.map((name) => [name, makeHandler()])
  );
  let stopped = 0;
  let resized = 0;
  const canvas = { style: { cursor: 'pointer', touchAction: '', removeProperty() {} } };
  const map = {
    stop: () => {
      stopped += 1;
    },
    resize: () => {
      resized += 1;
    },
    getCanvas: () => canvas,
    ...Object.fromEntries(
      MAP_GESTURE_HANDLER_NAMES.map((name) => [name, handlers[name].handler])
    ),
  } as unknown as MapGestureMap;

  restoreMapInteractions(map);

  assert(stopped === 1, 'restore should stop the camera');
  assert(resized === 1, 'restore should resize');
  for (const name of MAP_GESTURE_HANDLER_NAMES) {
    const s = handlers[name].stats();
    assert(s.resets === 1, `${name} should reset`);
    assert(s.disables === 1, `${name} should bounce disable`);
    assert(s.enables === 1, `${name} should bounce enable`);
    assert(s.enabled, `${name} should end enabled`);
  }
  assert(canvas.style.cursor === '', 'stuck pointer cursor should clear');
  assert(canvas.style.touchAction === 'none', 'canvas touch-action restored');
}

function testSuspendThenRestore() {
  const pan = makeHandler();
  const map = {
    dragPan: pan.handler,
    stop: () => {},
    resize: () => {},
  } as unknown as MapGestureMap;

  suspendMapInteractions(map);
  assert(!pan.stats().enabled, 'suspend should disable dragPan');
  restoreMapInteractions(map);
  assert(pan.stats().enabled, 'restore should re-enable dragPan');
}

function testReleaseCapturedPointer() {
  let released: number | null = null;
  const el = {
    hasPointerCapture: (id: number) => id === 7,
    releasePointerCapture: (id: number) => {
      released = id;
    },
  } as unknown as HTMLElement;
  releaseCapturedPointer(el, 7);
  assert(released === 7, 'should release matching pointer id');
  released = null;
  releaseCapturedPointer(el, 3);
  assert(released === null, 'should ignore ids without capture');
}

testRestoreBouncesEnabledHandlers();
testSuspendThenRestore();
testReleaseCapturedPointer();
console.log('mapInteractions tests ok');
