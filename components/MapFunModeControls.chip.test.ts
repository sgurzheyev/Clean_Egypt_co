/**
 * Idle RUSH must share the collapsed WX chip class. Active craft modes
 * keep that padding / type / radius and only then add color, icon, and count.
 * Run: npx tsx components/MapFunModeControls.chip.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import MapFunModeControls, {
  MAP_DEBUG_CHIP_IDLE_CLASS,
  rushChipClass,
} from './MapFunModeControls.tsx';
import type { RushCraftMode } from '../src/lib/mapFunMode.ts';

await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: { liveMapTraffic: 'RUSH' } } },
  interpolation: { escapeValue: false },
});

function markup(mode: RushCraftMode, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MapFunModeControls, {
        mode,
        onModeChange: () => {},
        ...extra,
      })
    )
  );
}

function buttonClass(html: string): string {
  const match = html.match(/<button[^>]*class="([^"]+)"/);
  assert.ok(match, `button class missing in ${html}`);
  return match[1];
}

const IDLE_METRICS = ['rounded-md', 'px-1.5', 'py-0.5', 'text-[9px]', 'font-black', 'tracking-wider'];
const BLOAT = ['rounded-2xl', 'rounded-xl', 'p-2.5', 'shadow-xl', 'text-[11px]', 'px-3', 'py-2', 'backdrop-blur-md'];

assert.equal(rushChipClass('off'), MAP_DEBUG_CHIP_IDLE_CLASS, 'off class is the WX chip');
for (const token of IDLE_METRICS) {
  assert.ok(MAP_DEBUG_CHIP_IDLE_CLASS.includes(token), `idle missing ${token}`);
}
assert.ok(MAP_DEBUG_CHIP_IDLE_CLASS.includes('opacity-40'), 'idle stays low contrast');
assert.ok(MAP_DEBUG_CHIP_IDLE_CLASS.includes('bg-black/40'), 'idle uses the dark WX fill');

const picker = readFileSync(new URL('./MapPicker.tsx', import.meta.url), 'utf8');
const wxAt = picker.indexOf('aria-label="Weather debug"');
assert.ok(wxAt >= 0, 'WX button still exists');
const wxBlock = picker.slice(wxAt, wxAt + 420);
assert.ok(
  wxBlock.includes('className={MAP_DEBUG_CHIP_IDLE_CLASS}'),
  'collapsed WX button uses the shared idle class'
);
assert.equal(wxBlock.includes('opacity-40'), false, 'WX no longer inlines the idle class string');
assert.equal(wxBlock.includes('px-3'), false, 'WX chip was not enlarged');

const off = markup('off');
assert.equal(buttonClass(off), MAP_DEBUG_CHIP_IDLE_CLASS, 'idle button class matches WX');
assert.match(off, /aria-pressed="false"/);
assert.match(off, /data-rush-mode="off"/);
assert.doesNotMatch(off, /<svg/i, 'idle hides craft icons');
assert.match(off, />RUSH</);
assert.doesNotMatch(off, />0</, 'idle hides the count');
for (const token of BLOAT) {
  assert.equal(off.includes(token), false, `idle still has ${token}`);
}

const ships = markup('ships', { shipsCount: 4 });
assert.match(ships, /aria-pressed="true"/);
assert.match(ships, /data-rush-mode="ships"/);
assert.match(ships, /<svg/i, 'ships mode shows an icon');
assert.match(ships, />4</);
assert.ok(buttonClass(ships).includes('text-amber-50'), 'ships accent');
assert.ok(buttonClass(ships).includes('opacity-100'), 'ships chip is visible');
assert.equal(buttonClass(ships).includes('opacity-40'), false, 'ships chip is not the idle ink');
for (const token of IDLE_METRICS) {
  assert.ok(buttonClass(ships).includes(token), `ships chip missing ${token}`);
}
for (const token of BLOAT) {
  assert.equal(ships.includes(token), false, `ships markup still has ${token}`);
}

const planes = markup('planes', { flightsCount: 0 });
assert.match(planes, /data-rush-mode="planes"/);
assert.match(planes, /<svg/i, 'planes mode shows an icon');
assert.match(planes, />0</);
assert.ok(buttonClass(planes).includes('text-lime-50'), 'planes accent');
assert.ok(buttonClass(planes).includes('shadow-[0_0_10px_rgba(163,230,53,0.45)]'), 'planes glow');
for (const token of IDLE_METRICS) {
  assert.ok(buttonClass(planes).includes(token), `planes chip missing ${token}`);
}
for (const token of BLOAT) {
  assert.equal(planes.includes(token), false, `planes markup still has ${token}`);
}

console.log('MapFunModeControls chip: ok');
