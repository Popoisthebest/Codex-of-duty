// Heavy-combat audio load test.
//
// A previous layering pass faulted the WebAudio context during full 6v6 combat
// and silenced the entire match. The normal gates cannot catch that: headless
// harness runs never unlock an audio context, so `state` stays `uninitialized`
// and every voice counter reads zero.
//
// This launches with autoplay permitted, unlocks the context with a real
// gesture, runs sustained 6v6 combat, and reports what the audio system actually
// did: peak simultaneous voices against the budget, how many sounds were dropped
// and why, and the split by category.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ARTIFACTS, withDevServer, newHarnessPage, ensureDir } from './lib/common.mjs';

const SECONDS = Number(process.env.COD_AUDIO_SECONDS || 90);
const failures = [];

await withDevServer(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-angle=metal',
      // Without these the context never leaves 'suspended' and the run measures
      // nothing at all.
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  });
  try {
    const { page, context } = await newHarnessPage(browser, {});

    // A real gesture, because that is what the production unlock listens for.
    await page.mouse.click(640, 360);
    await page.waitForFunction(
      () => window.__COD_HARNESS__?.snapshot()?.audio?.state === 'running',
      null,
      { timeout: 15000 },
    ).catch(() => {});

    const before = await page.evaluate(() => window.__COD_HARNESS__.snapshot()?.audio ?? null);
    if (before?.state !== 'running') {
      failures.push(`Audio context never started (state=${before?.state}); load was not exercised.`);
    }

    const result = await page.evaluate(async (seconds) => {
      return window.__COD_HARNESS__.runScenario('combat-soak', { seed: 4242, seconds });
    }, SECONDS);

    // Read the scenario's own audio snapshot, not the bridge's. The scenario
    // does a verification reset after building its result, and that reset zeroes
    // every counter - reading afterwards measures the reset, not the combat.
    const audio = result?.audio ?? null;
    console.log(JSON.stringify({ scenarioOk: result?.ok, audio }, null, 2));

    if (audio) {
      if (audio.state !== 'running') {
        failures.push(`Audio context is '${audio.state}' after combat - it faulted or was closed.`);
      }
      if (audio.peakVoices > audio.voiceBudget) {
        failures.push(`Peak voices ${audio.peakVoices} exceeded budget ${audio.voiceBudget}.`);
      }
      // Note: `activeVoices` is deliberately not asserted here. The scenario
      // simulates synchronously, so the main thread never yields and WebAudio
      // cannot deliver a single `ended` callback for the whole run - every voice
      // still reads active at the end regardless of health. `peakVoices` is the
      // meaningful number, because `canPlay` gates on the same counter.
      if (!audio.eventsPlayed) {
        failures.push('No audio events played during sustained combat.');
      }
      // Gunfire must never be starved out by lower-priority sound. Under
      // synchronous simulation voices cannot retire, so this checks the ordering
      // that priority is supposed to guarantee rather than a steady-state mix.
      const kinds = audio.voicesByKind ?? {};
      if ((kinds.footstep ?? 0) > 0 && (kinds.gunfire ?? 0) === 0 && audio.enemyShotEvents > 20) {
        failures.push(`Footsteps played (${kinds.footstep}) while ${audio.enemyShotEvents} shots produced no gunfire voice - priority ordering is wrong.`);
      }
    }
    if (result?.runtimeErrors) failures.push(`Scenario runtime errors: ${JSON.stringify(result.errors)}`);

    await context.close();
  } finally {
    await browser.close();
  }
});

const outDir = path.join(ARTIFACTS, 'audio');
ensureDir(outDir);
fs.writeFileSync(
  path.join(outDir, `audio-load-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
  JSON.stringify({ seconds: SECONDS, failures }, null, 2),
);

if (failures.length) {
  console.error(`\nAUDIO LOAD FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\naudio load ok over ${SECONDS}s of 6v6 combat`);
