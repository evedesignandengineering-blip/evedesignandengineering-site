// HV/LV/RE separation rule (DCSH Part 4 drawings H01-1, H04-1, H05-5, H10-1), confirmed by Ishan 2026-10-31.
// Built into the website at his request (2026-11-01). A loaded rule .json overrides it.
window.PNW_HVLV = {
  hvToRe: {
    'H01-1': { mm: 750, ref: 'H01-1 Rev J (king bolt to RE 750)' },
    'H04-1': { mm: 1200, ref: 'H04-1 Rev J (termination bolt to RE 1200; double termination crossarm is 700 lower)' },
    'H05-5': { mm: 2250, ref: 'H05-5 Rev A (king bolt hole to RE 1050 + 1200)' },
    'H10-1': { mm: 2135, lvKb: 4085, ref: 'H10-1 Rev L (top king bolt 635 + 2250 to the hanger arm, 1200 to the LV crossarm)' }
  },
  bare: {
    SCAC: { mm: 650, match: 'SC\\s*/?\\s*AC|SCAC', ref: 'H01-1 note 5(a) bare LV, SCAC RE 650' },
    SCGZ: { mm: 650, match: 'SC\\s*/?\\s*GZ|SCGZ', ref: 'H01-1 note 5(a) bare LV, SCGZ RE 650' },
    AAAC: { mm: 1100, match: 'AAAC', ref: 'H01-1 note 5(a) bare LV, AAAC RE 1100' }
  },
  abc: { mm: 450, ref: 'H01-1 note 5(b) LV ABC 450' },
  noRe: { 'default': { mm: 450, ref: 'H01-1 note 6 no RE 450 (1200 from the HV king bolt)' }, 'H04-1': { mm: 250, ref: 'H04-1 note 4 no RE 250' } }
};
