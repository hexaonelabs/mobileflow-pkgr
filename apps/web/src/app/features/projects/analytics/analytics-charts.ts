import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Chart, registerables } from 'chart.js';
import { ProjectsService } from '../../../core/projects/projects.service';

Chart.register(...registerables);

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// L'API n'expose pas le `dailyBreakdown` (30 derniers jours) via un endpoint —
// seul `getTrends()` (3 derniers mois) est public. Le graphique de tendance
// est donc mensuel plutôt que journalier.
@Component({
  selector: 'app-analytics-charts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-2xl border border-neutral-200 bg-white p-5">
      <h3 class="text-sm font-semibold text-neutral-900">Trends (last 3 months)</h3>
      @if (errorMessage()) {
        <p role="alert" class="mt-2 text-sm text-red-700">{{ errorMessage() }}</p>
      } @else if (!loaded()) {
        <p role="status" class="mt-2 text-sm text-neutral-500">Loading trends…</p>
      }
      <div class="mt-4" [class.hidden]="!loaded() || errorMessage()">
        <canvas #canvas role="img" aria-label="Monthly build volume and success rate"></canvas>
      </div>
    </section>
  `,
})
export class AnalyticsChartsComponent implements OnDestroy {
  private readonly projectsService = inject(ProjectsService);
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart | null = null;

  readonly projectId = input.required<string>();

  protected readonly loaded = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const canvas = this.canvasRef();
      if (!canvas) return;

      this.loaded.set(false);
      this.errorMessage.set(null);
      this.projectsService
        .getAnalyticsTrends(projectId)
        .then((trends) => {
          this.renderChart(canvas.nativeElement, trends.months);
          this.loaded.set(true);
        })
        .catch(() => this.errorMessage.set('Unable to load trends.'));
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private renderChart(
    canvas: HTMLCanvasElement,
    months: Array<{ year: number; month: number; total: number; successRate: number }>,
  ): void {
    this.chart?.destroy();
    this.chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: months.map((m) => `${MONTH_LABELS[m.month - 1]} ${m.year}`),
        datasets: [
          {
            type: 'bar',
            label: 'Total Builds',
            data: months.map((m) => m.total),
            backgroundColor: '#a3a3a3',
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: 'Success Rate (%)',
            data: months.map((m) => m.successRate),
            borderColor: '#36a64f',
            backgroundColor: '#36a64f',
            yAxisID: 'y1',
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Builds' } },
          y1: {
            beginAtZero: true,
            max: 100,
            position: 'right',
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Success rate (%)' },
          },
        },
      },
    });
  }
}
