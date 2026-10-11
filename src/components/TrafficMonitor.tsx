import { useEffect, useState } from "react";
import { api, TrafficStats } from "../api";

type Props = {
  ruleId: string;
  ruleLabel: string;
};

export default function TrafficMonitor({ ruleId, ruleLabel }: Props) {
  const [stats, setStats] = useState<TrafficStats | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const s = await api.getTrafficStats(ruleId);
      if (mounted) setStats(s);
    };
    load();
    const un = api.onTrafficUpdate((e) => {
      if (e.ruleId === ruleId && mounted) setStats(e.stats);
    });
    return () => {
      mounted = false;
      un.then((f) => f());
    };
  }, [ruleId]);

  if (!stats || stats.history.length === 0) {
    return (
      <div className="traffic-monitor empty">
        <span>Нет данных о трафике</span>
      </div>
    );
  }

  const maxSent = Math.max(...stats.history.map((p) => p.sent), 1);
  const maxReceived = Math.max(...stats.history.map((p) => p.received), 1);

  return (
    <div className="traffic-monitor">
      <div className="traffic-header">
        <span className="traffic-label">{ruleLabel}</span>
        <span className="traffic-total">
          ↑ {formatBytes(stats.bytesSent)} · ↓ {formatBytes(stats.bytesReceived)}
        </span>
      </div>
      <svg
        className="traffic-chart"
        viewBox="0 0 200 40"
        preserveAspectRatio="none"
      >
        <polyline
          points={stats.history
            .map((p, i) => {
              const x = (i / (stats.history.length - 1 || 1)) * 200;
              const y = 40 - (p.sent / maxSent) * 38;
              return `${x},${y}`;
            })
            .join(" ")}
          fill="none"
          stroke="#0a84ff"
          strokeWidth="1.5"
        />
        <polyline
          points={stats.history
            .map((p, i) => {
              const x = (i / (stats.history.length - 1 || 1)) * 200;
              const y = 40 - (p.received / maxReceived) * 38;
              return `${x},${y}`;
            })
            .join(" ")}
          fill="none"
          stroke="#34c759"
          strokeWidth="1.5"
        />
      </svg>
      <div className="traffic-legend">
        <span>
          <i style={{ background: "#0a84ff" }} /> Отправлено
        </span>
        <span>
          <i style={{ background: "#34c759" }} /> Получено
        </span>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
