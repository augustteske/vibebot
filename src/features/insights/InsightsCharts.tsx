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
              outerRadius="84%" paddingAngle={2} stroke="#fff" strokeWidth={2}>
              <Cell fill="#FFD329" />
              <Cell fill="#111" />
            </Pie>
            <Tooltip formatter={(value) => [`${value}%`]} />
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
          <BarChart data={data} margin={{ top: 24, right: 12, bottom: 4, left: -20 }}>
            <CartesianGrid vertical={false} stroke="#ddd" strokeDasharray="3 3" />
            <XAxis dataKey="name" hide />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false}
              axisLine={false} tickFormatter={value => `${value}%`} />
            <Tooltip formatter={value => [`${value}%`, 'Равномерность участия']} />
            <Bar dataKey="value" fill="#FFD329" stroke="#111" strokeWidth={1} radius={[6, 6, 0, 0]}>
              <LabelList dataKey="value" position="top" formatter={value => `${value}%`} fill="#111" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
    </div>
  )
}
