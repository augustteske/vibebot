import type { ActionRecommendationCardProps } from './ActionRecommendationCard';

export const demoActionRecommendation: ActionRecommendationCardProps = {
  observation: 'В закрытом периоде стало больше общения вне рабочих часов (25%)',
  explanation: 'Возможно, изменились ожидания по доступности',
  limitation: 'Срочные задачи или неверно заданное расписание могли повлиять',
  suggestedAction: 'Обсудить, когда ответ можно отложить до рабочего дня',
  dataSource: 'chat',
  generationSource: 'template',
  periodLabel: 'период: демо, 7 дней',
  demo: true,
};