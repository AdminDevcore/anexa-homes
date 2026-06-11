"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  Legend,
} from "recharts";

const GOLD = "#BFA15F";
const PALETTE = ["#BFA15F", "#0B0B0C", "#A1A1AA", "#D4B775", "#71717A", "#52525B", "#E4D5B0", "#27272A"];

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-4 font-semibold">{title}</h3>
      <div className="h-64 w-full">{children}</div>
    </div>
  );
}

export function BarChartCard({
  title,
  data,
  dataKey,
  nameKey,
  format,
}: {
  title: string;
  data: Record<string, string | number>[];
  dataKey: string;
  nameKey: string;
  format?: "currencyK";
}) {
  const fmt = (v: number) => (format === "currencyK" ? `$${(v / 1000).toFixed(0)}k` : String(v));
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
          <XAxis dataKey={nameKey} tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(Number(v))} width={48} />
          <Tooltip formatter={(value) => fmt(Number(value))} cursor={{ fill: "rgba(191,161,95,0.08)" }} />
          <Bar dataKey={dataKey} fill={GOLD} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function PieChartCard({
  title,
  data,
  dataKey,
  nameKey,
}: {
  title: string;
  data: Record<string, string | number>[];
  dataKey: string;
  nameKey: string;
}) {
  return (
    <ChartCard title={title}>
      {data.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No data yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%" minHeight={240}>
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Pie
              data={data}
              dataKey={dataKey}
              nameKey={nameKey}
              cx="50%"
              cy="46%"
              // Relative radii (not fixed px): if ResponsiveContainer briefly reports a
              // 0 width on first paint, the pie scales to nothing and then grows once
              // measured — instead of drawing a fixed-90px sliver in the corner. The
              // segments are identified by the legend below, not clipped outside labels.
              outerRadius="78%"
              innerRadius="52%"
              // A lone slice should be a clean full ring (no padding-gap notch).
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="none"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend
              verticalAlign="bottom"
              height={28}
              iconType="circle"
              wrapperStyle={{ fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
