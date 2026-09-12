// Horário padrão das salas: Segunda a Sexta 07:00 às 22:00 | Sábado 07:00 às 14:00
export const HOURS_START = 7;
export const HOURS_END = 22; 
export const SATURDAY_HOURS_END = 14;

/**
 * Retorna o horário de fechamento para um determinado dia da semana.
 * Segunda a Sexta: 22h | Sábado: 14h | Domingo: 0 (Fechado)
 */
export function getClosingHourForDate(dateOrDayOfWeek: Date | number | string): number {
  let dayOfWeek: number;
  if (typeof dateOrDayOfWeek === 'number') {
    dayOfWeek = dateOrDayOfWeek;
  } else if (typeof dateOrDayOfWeek === 'string') {
    const [y, m, d] = dateOrDayOfWeek.split('-').map(Number);
    dayOfWeek = new Date(y, m - 1, d).getDay();
  } else {
    dayOfWeek = dateOrDayOfWeek.getDay();
  }

  if (dayOfWeek === 0) return 0; // Domingo fechado
  if (dayOfWeek === 6) return SATURDAY_HOURS_END; // Sábado até 14h
  return HOURS_END; // Seg-Sex até 22h
} 

export const DAYS_OF_WEEK = [
  'Domingo', 
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado'
];

export const INITIAL_HOURLY_RATE = 40.0;
export const INITIAL_DAILY_RATE = 350.0;

export const STORAGE_KEYS = {
  CLIENTS: 'locapsico_clients_v2',
  BOOKINGS: 'locapsico_bookings_v2',
  BLOCKED_SLOTS: 'locapsico_blocked_v2',
  AUDIT_LOGS: 'locapsico_audit_v2',
  CONFIG: 'locapsico_config_v2',
  SEEDED: 'locapsico_seeded_v2'
};

export const HOLIDAYS = [
  '01-01', 
  '04-21', 
  '05-01', 
  '09-07', 
  '10-12', 
  '11-02', 
  '11-15', 
  '11-20', 
  '12-25', 
  '2026-02-16', 
  '2026-02-17', 
  '2026-04-03', 
  '2026-04-21', 
  '2026-06-04', 
];
