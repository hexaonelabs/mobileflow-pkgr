import { describe, expect, it } from 'vitest';
import { parseLogLine, parseLogText } from './log-parser';

describe('parseLogLine', () => {
  it('extrait le timestamp ISO et le contenu restant', () => {
    const line = parseLogLine('2026-09-15T20:01:50.3901170Z Current runner version: \'2.337.0\'');
    expect(line.timestamp).toBe('2026-09-15T20:01:50.3901170Z');
    expect(line.segments.map((segment) => segment.text).join('')).toBe(
      "Current runner version: '2.337.0'",
    );
    expect(line.kind).toBe('default');
  });

  it('détecte les lignes ##[error] et retire le marqueur du texte affiché', () => {
    const line = parseLogLine(
      '2026-09-15T20:02:36.7887210Z ##[error]Aucun provisioning profile iOS configuré dans le Secret Vault pour ce projet.',
    );
    expect(line.kind).toBe('error');
    expect(line.segments.map((segment) => segment.text).join('')).toBe(
      'Aucun provisioning profile iOS configuré dans le Secret Vault pour ce projet.',
    );
  });

  it('convertit les séquences ANSI en segments colorés sans laisser de code brut', () => {
    const line = parseLogLine('2026-09-15T20:01:51.3078650Z \x1b[36;1mLOG_FILE="$RUNNER_TEMP"\x1b[0m');
    const joined = line.segments.map((segment) => segment.text).join('');
    expect(joined).toBe('LOG_FILE="$RUNNER_TEMP"');
    expect(joined).not.toContain('\x1b');
    expect(line.segments.some((segment) => segment.className.includes('text-cyan-400'))).toBe(true);
  });

  it('gère les lignes sans timestamp', () => {
    const line = parseLogLine('added 1138 packages, and audited 1139 packages in 19s');
    expect(line.timestamp).toBeNull();
    expect(line.segments[0].text).toBe('added 1138 packages, and audited 1139 packages in 19s');
  });
});

describe('parseLogText', () => {
  it('regroupe les lignes entre ##[group] et ##[endgroup]', () => {
    const raw = [
      '2026-09-15T20:01:50.3921260Z ##[group]Runner Image Provisioner',
      '2026-09-15T20:01:50.3921830Z Hosted Compute Agent',
      '2026-09-15T20:01:50.3924460Z ##[endgroup]',
      '2026-09-15T20:02:22.5501590Z npm run build',
    ].join('\n');

    const entries = parseLogText(raw);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: 'group', title: 'Runner Image Provisioner', hasError: false });
    if (entries[0].type === 'group') {
      expect(entries[0].lines).toHaveLength(1);
      expect(entries[0].isOpenByDefault).toBe(false);
    }
    expect(entries[1]).toMatchObject({ type: 'line' });
  });

  it('déplie par défaut un groupe contenant une erreur', () => {
    const raw = [
      '2026-09-15T20:02:35.9327360Z ##[group]Run curl secrets',
      '2026-09-15T20:02:36.7887210Z ##[error]Aucun provisioning profile iOS configuré.',
      '2026-09-15T20:02:36.7970950Z ##[endgroup]',
    ].join('\n');

    const [entry] = parseLogText(raw);

    expect(entry).toMatchObject({ type: 'group', hasError: true, isOpenByDefault: true });
  });

  it("laisse déplié un groupe encore ouvert (pas de ##[endgroup], étape en cours)", () => {
    const raw = [
      '2026-09-15T20:01:56.5019790Z ##[group]Run actions/checkout@v4',
      '2026-09-15T20:01:56.5020330Z with:',
    ].join('\n');

    const [entry] = parseLogText(raw);

    expect(entry).toMatchObject({ type: 'group', isOpenByDefault: true });
  });

  it('ignore les lignes vides', () => {
    expect(parseLogText('')).toEqual([]);
    expect(parseLogText('\n\n')).toEqual([]);
  });
});
