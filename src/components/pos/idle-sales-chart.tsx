import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function IdleSalesChart({ data }: { data: Array<{ day: string; sales: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 8, left: -24, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,.1)" vertical={false} />
        <XAxis
          dataKey="day"
          tick={{ fill: "rgba(255,255,255,.62)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "rgba(255,255,255,.48)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          formatter={(value) =>
            new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
            }).format(Number(value ?? 0))
          }
          contentStyle={{
            background: "#10231f",
            border: "1px solid rgba(255,255,255,.18)",
            borderRadius: 12,
          }}
        />
        <Bar dataKey="sales" fill="#63d7a3" radius={[5, 5, 0, 0]} isAnimationActive />
      </BarChart>
    </ResponsiveContainer>
  );
}
