/**
 * Fun-map chip stays a small toggle. Off uses the faint idle chip; on adds cyan.
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
  funChipClass,
} from './MapFunModeControls.tsx';

await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: { funMapMode: 'FUN' } } },
  interpolation: { escapeValue: false },
});

function markup(on: boolean) {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MapFunModeControls, {
        on,
        onChange: () => {},
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

assert.equal(funChipClass(false), MAP_DEBUG_CHIP_IDLE_CLASS, 'off class is the idle chip');
for (const token of IDLE_METRICS) {
  assert.ok(MAP_DEBUG_CHIP_IDLE_CLASS.includes(token), `idle missing ${token}`);
}

const picker = readFileSync(new URL('./MapPicker.tsx', import.meta.url), 'utf8');
assert.equal(picker.includes('Weather debug'), false, 'weather debug control is gone');
assert.equal(picker.includes('WeatherOverlay'), false, 'weather overlay is gone');
assert.equal(picker.includes('liveMapTraffic'), false, 'RUSH copy is gone');
assert.equal(picker.includes('opensky'), false, 'OpenSky client path is gone');
assert.equal(picker.includes('open-meteo'), false, 'Open-Meteo client path is gone');
assert.equal(picker.includes('aisstream'), false, 'AIS client path is gone');

const off = markup(false);
assert.equal(buttonClass(off), MAP_DEBUG_CHIP_IDLE_CLASS, 'idle button class');
assert.match(off, /aria-pressed="false"/);
assert.match(off, /data-fun-map="off"/);
assert.match(off, />FUN</);
assert.doesNotMatch(off, /RUSH/);
assert.doesNotMatch(off, /SHIP|PLANE/i);

const on = markup(true);
assert.match(on, /aria-pressed="true"/);
assert.match(on, /data-fun-map="on"/);
assert.ok(buttonClass(on).includes('text-cyan-50'), 'on accent');
assert.doesNotMatch(on, /RUSH/);

console.log('MapFunModeControls chip: ok');
