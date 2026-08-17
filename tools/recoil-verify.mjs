// Independent verification that recoil actually recovers.
//
// The implementation was previously "verified by construction" only, because an
// ad-hoc probe never triggered production firing and silently reported zero
// displacement either way. This drives the real input and weapon path and fails
// loudly if the magazine does not actually fire.
import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS, withDevServer, launchBrowser, newHarnessPage, ensureDir, assertNoBrowserErrors } from './lib/common.mjs';

const failures = [];
let report = null;

await withDevServer(async () => {
  const browser = await launchBrowser();
  try {
    const { page, context, errors } = await newHarnessPage(browser, {});
    report = await page.evaluate(async () => {
      const r = await window.__COD_HARNESS__.runAction('measure_recoil', { frames: 240 });
      return r?.recoil ?? null;
    });
    if (!report) failures.push('measure_recoil returned no recoil report.');
    else {
      const { shotsFired, initial, peakPitch, atRelease, series, settled, residual } = report;
      console.log(`shots fired      : ${shotsFired} of ${report.startAmmo} (frames ${report.firedFrames})`);
      console.log(`initial pitch    : ${initial.pitch} deg`);
      console.log(`peak displacement: ${(peakPitch - initial.pitch).toFixed(3)} deg (frame ${report.peakFrame})`);
      for (const b of report.burst ?? []) {
        console.log(`  round ${String(b.round).padStart(2)}         : ${(b.pitch - initial.pitch).toFixed(3)} deg`);
      }
      console.log(`at release       : ${(atRelease.pitch - initial.pitch).toFixed(3)} deg   viewKick ${atRelease.viewKick}`);
      for (const s of series) {
        console.log(`  +${String(s.msAfterRelease).padStart(4)} ms      : ${(s.pitch - initial.pitch).toFixed(3)} deg   viewKick ${s.viewKick}  pending ${s.pending}`);
      }
      console.log(`final residual   : ${residual} deg`);

      // The magazine must actually have fired, or nothing below means anything.
      if (shotsFired < 20) failures.push(`Only ${shotsFired} rounds fired; the rig did not exercise sustained fire.`);
      // Recoil must actually displace aim, or there is nothing to recover.
      if (peakPitch - initial.pitch < 1) failures.push(`Peak displacement ${(peakPitch - initial.pitch).toFixed(2)} deg - recoil is not moving the aim.`);
      // The whole point: it must come back.
      if (Math.abs(residual) > 1.0) failures.push(`Residual recoil ${residual} deg after settling - recoil does not recover.`);
      // The viewmodel must not claim to be settled while the aim is still displaced.
      const oneSecond = series.find((s) => s.msAfterRelease === 1000);
      if (oneSecond && Math.abs(oneSecond.viewKick) < 0.3 && Math.abs(oneSecond.pitch - initial.pitch) > 2.5) {
        failures.push(`Viewmodel reads settled (kick ${oneSecond.viewKick}) while aim is still ${(oneSecond.pitch - initial.pitch).toFixed(2)} deg off - they disagree.`);
      }
    }
    try { assertNoBrowserErrors(errors); } catch (e) { failures.push(`Browser errors: ${e?.message ?? e}`); }
    await context.close();
  } finally { await browser.close(); }
});

const outDir = path.join(ARTIFACTS, 'recoil');
ensureDir(outDir);
fs.writeFileSync(path.join(outDir, `recoil-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ failures, report }, null, 2));

if (failures.length) {
  console.error(`\nRECOIL VERIFICATION FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nrecoil verification ok');
