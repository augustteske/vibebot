import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface InsightsChartsProps {
  metric: 'outsideHoursPercent' | 'participationEvenness';
  value: number;
}

// Подсказка и легенда читаются в обеих темах: цвета берутся из CSS-переменных.
const tooltipStyle = {
  background: 'var(--vibee-surface)',
  border: '1px solid var(--vibee-line)',
  borderRadius: '10px',
  color: 'var(--vibee-ink)',
}

const tooltipTextStyle = { color: 'var(--vibee-ink)' }

export function InsightsCharts({ metric, value }: InsightsChartsProps) {
  if (metric === 'outsideHoursPercent') {
    const data = [
      { name: 'Вне рабочих часов', value },
      { name: 'В рабочее время', value: 100 - value },
    ]

    return (
      <div className="iw-chart iw-chart--donut" role="img"
        aria-label={`Вне рабочих часов: ${value} процентов сообщений`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%"
              outerRadius="84%" paddingAngle={2}
              stroke="var(--vibee-surface)" strokeWidth={2}>
              <Cell fill="var(--vibee-yellow)" />
              <Cell fill="var(--vibee-ink)" />
            </Pie>
            <Tooltip
              formatter={(value) => [`${value}%`]}
              contentStyle={tooltipStyle}
              itemStyle={tooltipTextStyle}
              labelStyle={tooltipTextStyle}
            />
            <Legend verticalAlign="bottom" height={28} iconType="circle" />
          </PieChart>
        </ResponsiveContainer>
        <span className="iw-chart-center">{value}%</span>
      </div>
    )
  }

  const data = [{ name: 'Равномерность участия', value }]
  return (
    <div className="iw-chart" role="img" aria-label={`Равномерность участия: ${value} процентов`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 24, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--vibee-line)" strokeDasharray="3 3" />
            <XAxis dataKey="name" hide />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false}
              axisLine={false} tickFormatter={value => `${value}%`} />
            <Tooltip
              formatter={value => [`${value}%`, 'Равномерность участия']}
              contentStyle={tooltipStyle}
              itemStyle={tooltipTextStyle}
              labelStyle={tooltipTextStyle}
            />
            <Bar dataKey="value" fill="var(--vibee-yellow)" stroke="var(--vibee-ink)" strokeWidth={1}
              radius={[6, 6, 0, 0]}>
              <LabelList dataKey="value" position="top" formatter={value => `${value}%`}
                fill="var(--vibee-chart-text)" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
    </div>
  )
}
