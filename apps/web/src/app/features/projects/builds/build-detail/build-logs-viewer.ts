import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { parseLogText, type LogEntry, type LogLineKind } from './log-parser';

const TIMESTAMP_CLASS = 'shrink-0 select-none text-neutral-600';
const ROW_CLASS = 'flex gap-3 whitespace-pre px-1 leading-5';

const LINE_KIND_CLASSES: Record<LogLineKind, string> = {
  error: 'bg-red-950/60 text-red-300',
  warning: 'bg-yellow-950/40 text-yellow-300',
  command: 'text-neutral-400',
  default: '',
};

@Component({
  selector: 'app-build-logs-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col text-xs">
      @for (entry of entries(); track $index) {
        @if (entry.type === 'line') {
          <div class="${ROW_CLASS}" [class]="lineClass(entry.line.kind)">
            @if (showTimestamps()) {
              <span class="${TIMESTAMP_CLASS}">{{ formatTimestamp(entry.line.timestamp) }}</span>
            }
            @if (entry.line.kind === 'error') {
              <span aria-hidden="true">✖</span>
            } @else if (entry.line.kind === 'warning') {
              <span aria-hidden="true">▲</span>
            }
            <span>
              @for (segment of entry.line.segments; track $index) {
                <span [class]="segment.className">{{ segment.text }}</span>
              }
            </span>
          </div>
        } @else {
          <details class="group/log-group" [open]="entry.isOpenByDefault">
            <summary
              class="flex cursor-pointer select-none items-center gap-2 whitespace-pre rounded px-1 py-0.5 text-neutral-300 hover:bg-neutral-800"
              [class.text-red-300]="entry.hasError"
            >
              <svg
                aria-hidden="true"
                class="h-3 w-3 shrink-0 transition-transform group-open/log-group:rotate-90"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                  clip-rule="evenodd"
                />
              </svg>
              {{ entry.title }}
            </summary>
            <div class="ml-3.5 border-l border-neutral-800 pl-3">
              @for (line of entry.lines; track $index) {
                <div class="${ROW_CLASS}" [class]="lineClass(line.kind)">
                  @if (showTimestamps()) {
                    <span class="${TIMESTAMP_CLASS}">{{ formatTimestamp(line.timestamp) }}</span>
                  }
                  @if (line.kind === 'error') {
                    <span aria-hidden="true">✖</span>
                  } @else if (line.kind === 'warning') {
                    <span aria-hidden="true">▲</span>
                  }
                  <span>
                    @for (segment of line.segments; track $index) {
                      <span [class]="segment.className">{{ segment.text }}</span>
                    }
                  </span>
                </div>
              }
            </div>
          </details>
        }
      }
    </div>
  `,
})
export class BuildLogsViewer {
  readonly text = input('');
  readonly showTimestamps = input(false);

  protected readonly entries = computed<LogEntry[]>(() => parseLogText(this.text()));

  protected lineClass(kind: LogLineKind): string {
    return LINE_KIND_CLASSES[kind];
  }

  protected formatTimestamp(iso: string | null): string {
    if (!iso) {
      return '';
    }
    return iso.slice(11, 19);
  }
}
