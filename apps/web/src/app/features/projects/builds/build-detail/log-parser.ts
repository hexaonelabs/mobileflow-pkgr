// Parseur pour les logs bruts des workflows GitHub Actions : timestamps ISO en préfixe de
// chaque ligne, séquences ANSI SGR pour la couleur, et marqueurs `##[group]`/`##[endgroup]`/
// `##[error]`/`##[warning]`/`##[command]` propres au format de log d'Actions.

export interface LogLineSegment {
  readonly text: string;
  readonly className: string;
}

export type LogLineKind = 'error' | 'warning' | 'command' | 'default';

export interface LogLine {
  readonly timestamp: string | null;
  readonly kind: LogLineKind;
  readonly segments: LogLineSegment[];
}

export interface LogGroupEntry {
  readonly type: 'group';
  readonly title: string;
  readonly lines: LogLine[];
  readonly hasError: boolean;
  readonly isOpenByDefault: boolean;
}

export interface LogLineEntry {
  readonly type: 'line';
  readonly line: LogLine;
}

export type LogEntry = LogGroupEntry | LogLineEntry;

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z) ?(.*)$/;
// eslint-disable-next-line no-control-regex
const ANSI_SGR_PATTERN = /\x1b\[([0-9;]*)m/g;

const ANSI_FOREGROUND_CLASSES: Record<string, string> = {
  '30': 'text-neutral-500',
  '31': 'text-red-400',
  '32': 'text-green-400',
  '33': 'text-yellow-400',
  '34': 'text-blue-400',
  '35': 'text-fuchsia-400',
  '36': 'text-cyan-400',
  '37': 'text-neutral-100',
  '39': '',
};

const LINE_MARKERS: ReadonlyArray<{ prefix: string; kind: LogLineKind }> = [
  { prefix: '##[error]', kind: 'error' },
  { prefix: '##[warning]', kind: 'warning' },
  { prefix: '##[command]', kind: 'command' },
  { prefix: '[command]', kind: 'command' },
];

const GROUP_START_PREFIX = '##[group]';
const GROUP_END_PREFIX = '##[endgroup]';

function buildSegmentClassName(fgClass: string, bold: boolean): string {
  return [fgClass, bold ? 'font-semibold' : ''].filter(Boolean).join(' ');
}

function splitAnsiSegments(text: string): LogLineSegment[] {
  const segments: LogLineSegment[] = [];
  let lastIndex = 0;
  let bold = false;
  let fgClass = '';
  ANSI_SGR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANSI_SGR_PATTERN.exec(text)) !== null) {
    const chunk = text.slice(lastIndex, match.index);
    if (chunk) {
      segments.push({ text: chunk, className: buildSegmentClassName(fgClass, bold) });
    }
    for (const code of match[1].split(';').filter(Boolean)) {
      if (code === '0') {
        bold = false;
        fgClass = '';
      } else if (code === '1') {
        bold = true;
      } else if (code === '22') {
        bold = false;
      } else if (code in ANSI_FOREGROUND_CLASSES) {
        fgClass = ANSI_FOREGROUND_CLASSES[code];
      }
    }
    lastIndex = ANSI_SGR_PATTERN.lastIndex;
  }
  const rest = text.slice(lastIndex);
  if (rest || segments.length === 0) {
    segments.push({ text: rest, className: buildSegmentClassName(fgClass, bold) });
  }
  return segments;
}

function classifyAndStripMarker(content: string): { kind: LogLineKind; content: string } {
  for (const marker of LINE_MARKERS) {
    if (content.startsWith(marker.prefix)) {
      return { kind: marker.kind, content: content.slice(marker.prefix.length) };
    }
  }
  return { kind: 'default', content };
}

export function parseLogLine(rawLine: string): LogLine {
  const match = TIMESTAMP_PATTERN.exec(rawLine);
  const timestamp = match ? match[1] : null;
  const rest = match ? match[2] : rawLine;
  const { kind, content } = classifyAndStripMarker(rest);
  return { timestamp, kind, segments: splitAnsiSegments(content) };
}

function plainText(line: LogLine): string {
  return line.segments.map((segment) => segment.text).join('');
}

export function parseLogText(raw: string): LogEntry[] {
  if (!raw) {
    return [];
  }
  const entries: LogEntry[] = [];
  let currentGroup: { title: string; lines: LogLine[]; hasError: boolean } | null = null;

  const flushGroup = (isOpenByDefault: boolean): void => {
    if (!currentGroup) {
      return;
    }
    entries.push({
      type: 'group',
      title: currentGroup.title,
      lines: currentGroup.lines,
      hasError: currentGroup.hasError,
      isOpenByDefault,
    });
    currentGroup = null;
  };

  for (const rawLine of raw.split('\n')) {
    if (rawLine.length === 0) {
      continue;
    }
    const line = parseLogLine(rawLine);
    const content = plainText(line);

    if (content.startsWith(GROUP_START_PREFIX)) {
      flushGroup(false);
      currentGroup = {
        title: content.slice(GROUP_START_PREFIX.length),
        lines: [],
        hasError: false,
      };
      continue;
    }
    if (content.startsWith(GROUP_END_PREFIX)) {
      flushGroup(currentGroup?.hasError ?? false);
      continue;
    }
    if (currentGroup) {
      currentGroup.lines.push(line);
      if (line.kind === 'error') {
        currentGroup.hasError = true;
      }
    } else {
      entries.push({ type: 'line', line });
    }
  }
  // Groupe encore ouvert (pas de `##[endgroup]`) : l'étape est probablement en cours, on le
  // laisse déplié plutôt que de masquer sa sortie live.
  flushGroup(true);
  return entries;
}
