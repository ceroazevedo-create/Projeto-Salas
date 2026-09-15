import { supabase, isSupabaseConfigured, translateSupabaseError } from './supabase';

/* =========================================================
   TIPOS
   ========================================================= */

export type BookingType = 'HOURLY' | 'PERIOD';
export type PeriodShift = 'MORNING' | 'AFTERNOON' | 'NIGHT';

export interface Booking {
  id: string;
  userId: string;
  professionalId?: string;
  clientId?: string | null;
  roomId: string;
  date: string;
  hour: number;
  durationHours: number;
  endHour: number;
  type: BookingType;
  periodShift?: PeriodShift;
  hourlyRate: number;
  periodRate?: number;
  totalAmount: number;
  paymentStatus: string;
  status: string;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateBookingParams {
  userId: string;
  roomId: string;
  date: string;
  hour?: number;
  durationHours?: number;
  type: BookingType;
  periodShift?: PeriodShift;
  clientId?: string | null;
  notes?: string | null;
}

export interface RoomRate {
  id?: string;
  room_id?: string;
  name?: string;
  hourly_rate?: number;
  morning_rate?: number;
  afternoon_rate?: number;
  night_rate?: number;
  period_morning_rate?: number;
  period_afternoon_rate?: number;
  period_night_rate?: number;
  price_per_hour?: number;
  price_morning?: number;
  price_afternoon?: number;
  price_night?: number;
  [key: string]: any;
}

/* =========================================================
   CONFIGURAÇÃO DOS PERÍODOS
   HORÁRIO OFICIAL: 07:00 ÀS 22:00
   ========================================================= */

const PERIODS = {
  MORNING: {
    startHour: 7,
    endHour: 12,
    duration: 5,
  },
  AFTERNOON: {
    startHour: 12,
    endHour: 18,
    duration: 6,
  },
  NIGHT: {
    startHour: 18,
    endHour: 22,
    duration: 4,
  },
} as const;

/* =========================================================
   STORAGE LOCAL
   ========================================================= */

const STORAGE_KEY = 'locapsico_bookings_v2';

function getStoredBookings(): Booking[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Erro ao ler reservas locais:', error);
    return [];
  }
}

function saveStoredBookings(bookings: Booking[]) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(bookings)
    );
  } catch (error) {
    console.warn('Erro ao salvar reservas locais:', error);
  }
}

/* =========================================================
   PERÍODOS
   ========================================================= */

export function getPeriodConfig(
  periodShift: PeriodShift,
  _date?: string
) {
  return PERIODS[periodShift];
}

function getPeriodFromHour(hour: number): PeriodShift | undefined {
  if (hour >= 7 && hour < 12) {
    return 'MORNING';
  }

  if (hour >= 12 && hour < 18) {
    return 'AFTERNOON';
  }

  if (hour >= 18 && hour < 22) {
    return 'NIGHT';
  }

  return undefined;
}

/* =========================================================
   MAPA DO SUPABASE → FRONTEND
   ========================================================= */

function mapDbBookingToBooking(b: any): Booking {
  const startHour = Number(
    b.start_time ??
    b.hour ??
    7
  );

  const endHour = Number(
    b.end_time ??
    (startHour + Number(b.total_hours ?? 1))
  );

  const durationHours = Number(
    b.total_hours ??
    Math.max(1, endHour - startHour)
  );

  const bookingType: BookingType =
    b.booking_type === 'PERIOD'
      ? 'PERIOD'
      : 'HOURLY';

  const periodShift =
    getPeriodFromHour(startHour);

  return {
    id: String(b.id),

    userId: String(
      b.professional_id ??
      b.user_id ??
      ''
    ),

    professionalId: b.professional_id
      ? String(b.professional_id)
      : undefined,

    clientId: b.client_id
      ? String(b.client_id)
      : null,

    roomId: String(b.room_id),

    date: String(
      b.booking_date ??
      b.date ??
      ''
    ),

    hour: startHour,

    durationHours,

    endHour,

    type: bookingType,

    periodShift,

    hourlyRate: Number(
      b.hourly_rate ??
      b.price_at_booking ??
      0
    ),

    periodRate:
      b.period_rate !== null &&
      b.period_rate !== undefined
        ? Number(b.period_rate)
        : undefined,

    totalAmount: Number(
      b.total_amount ??
      b.period_rate ??
      0
    ),

    paymentStatus:
      b.payment_status ??
      'PENDING',

    status:
      b.status ??
      'confirmed',

    notes:
      b.notes ??
      null,

    createdAt:
      b.created_at,

    updatedAt:
      b.updated_at,
  };
}

/* =========================================================
   BUSCAR RESERVAS
   ========================================================= */

export async function getAllBookings(): Promise<Booking[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .order('booking_date', {
        ascending: true,
      })
      .order('start_time', {
        ascending: true,
      });

    if (!error && data) {
      const bookings = data.map(
        mapDbBookingToBooking
      );

      saveStoredBookings(bookings);

      return bookings;
    }

    if (error) {
      console.warn(
        'Erro ao carregar reservas do Supabase:',
        error
      );
    }
  }

  return getStoredBookings();
}

/* =========================================================
   BUSCAR RESERVAS DE UM PROFISSIONAL
   ========================================================= */

export async function getBookingsByUserId(
  userId: string
): Promise<Booking[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('professional_id', userId)
      .order('booking_date', {
        ascending: true,
      })
      .order('start_time', {
        ascending: true,
      });

    if (!error && data) {
      return data.map(mapDbBookingToBooking);
    }

    if (error) {
      console.warn(
        'Erro ao carregar reservas do profissional:',
        error
      );
    }
  }

  return getStoredBookings().filter(
    booking =>
      booking.userId === userId ||
      booking.professionalId === userId
  );
}

/* =========================================================
   BUSCAR RESERVAS POR DATA
   ========================================================= */

export async function getBookingsByDate(
  date: string
): Promise<Booking[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('booking_date', date)
      .order('start_time', {
        ascending: true,
      });

    if (!error && data) {
      return data.map(mapDbBookingToBooking);
    }

    if (error) {
      console.warn(
        'Erro ao buscar reservas por data:',
        error
      );
    }
  }

  return getStoredBookings().filter(
    booking => booking.date === date
  );
}

/* =========================================================
   BUSCAR RESERVAS DE UMA SALA
   ========================================================= */

export async function getBookingsByRoom(
  roomId: string,
  date?: string
): Promise<Booking[]> {
  if (isSupabaseConfigured) {
    let query = supabase
      .from('bookings')
      .select('*')
      .eq('room_id', roomId);

    if (date) {
      query = query.eq(
        'booking_date',
        date
      );
    }

    const { data, error } = await query
      .order('booking_date', {
        ascending: true,
      })
      .order('start_time', {
        ascending: true,
      });

    if (!error && data) {
      return data.map(mapDbBookingToBooking);
    }

    if (error) {
      console.warn(
        'Erro ao buscar reservas da sala:',
        error
      );
    }
  }

  return getStoredBookings().filter(
    booking =>
      booking.roomId === roomId &&
      (!date || booking.date === date)
  );
}

/* =========================================================
   CONFLITO COM HORÁRIOS BLOQUEADOS
   ========================================================= */

async function checkBlockedSlotConflict(
  roomId: string,
  date: string,
  startHour: number,
  endHour: number
): Promise<boolean> {
  if (!isSupabaseConfigured) {
    return false;
  }

  const { data, error } = await supabase
    .from('blocked_slots')
    .select('*')
    .eq('room_id', roomId)
    .eq('blocked_date', date);

  if (error) {
    console.warn(
      'Erro ao verificar bloqueios:',
      error
    );

    return false;
  }

  if (!data || data.length === 0) {
    return false;
  }

  return data.some((slot: any) => {
    const blockedStart = Number(
      slot.start_time ??
      slot.hour ??
      0
    );

    const blockedEnd = Number(
      slot.end_time ??
      (blockedStart + Number(slot.duration_hours ?? 1))
    );

    return (
      startHour < blockedEnd &&
      endHour > blockedStart
    );
  });
}

/* =========================================================
   VERIFICAR CONFLITO COM OUTRAS RESERVAS
   ========================================================= */

export async function checkConflict(
  roomId: string,
  date: string,
  startHour: number,
  endHour: number,
  excludeBookingId?: string
): Promise<boolean> {
  const blockedConflict =
    await checkBlockedSlotConflict(
      roomId,
      date,
      startHour,
      endHour
    );

  if (blockedConflict) {
    return true;
  }

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('room_id', roomId)
      .eq('booking_date', date)
      .neq('status', 'cancelled');

    if (!error && data) {
      return data.some((booking: any) => {
        if (
          excludeBookingId &&
          String(booking.id) ===
            String(excludeBookingId)
        ) {
          return false;
        }

        const existingStart =
          Number(booking.start_time ?? 0);

        const existingEnd =
          Number(
            booking.end_time ??
            (
              existingStart +
              Number(
                booking.total_hours ?? 1
              )
            )
          );

        return (
          startHour < existingEnd &&
          endHour > existingStart
        );
      });
    }

    if (error) {
      console.warn(
        'Erro ao verificar conflito:',
        error
      );
    }
  }

  const localBookings =
    getStoredBookings();

  return localBookings.some(booking => {
    if (
      booking.roomId !== roomId ||
      booking.date !== date ||
      booking.status === 'cancelled'
    ) {
      return false;
    }

    if (
      excludeBookingId &&
      String(booking.id) ===
        String(excludeBookingId)
    ) {
      return false;
    }

    return (
      startHour < booking.endHour &&
      endHour > booking.hour
    );
  });
}

/* =========================================================
   BUSCAR TARIFAS DA SALA
   ========================================================= */

async function getRoomRate(
  roomId: string
): Promise<RoomRate | null> {
  if (!isSupabaseConfigured) {
    return null;
  }

  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .maybeSingle();

  if (error) {
    console.warn(
      'Erro ao buscar tarifa da sala:',
      error
    );

    return null;
  }

  return data;
}

/* =========================================================
   CALCULAR VALOR DA RESERVA
   ========================================================= */

function resolveHourlyRate(
  room: RoomRate | null
): number {
  if (!room) {
    return 0;
  }

  return Number(
    room.hourly_rate ??
    room.price_per_hour ??
    0
  );
}

function resolvePeriodRate(
  room: RoomRate | null,
  period: PeriodShift
): number {
  if (!room) {
    return 0;
  }

  if (period === 'MORNING') {
    return Number(
      room.morning_rate ??
      room.period_morning_rate ??
      room.price_morning ??
      0
    );
  }

  if (period === 'AFTERNOON') {
    return Number(
      room.afternoon_rate ??
      room.period_afternoon_rate ??
      room.price_afternoon ??
      0
    );
  }

  return Number(
    room.night_rate ??
    room.period_night_rate ??
    room.price_night ??
    0
  );
}

/* =========================================================
   CRIAR RESERVA
   ========================================================= */

export async function createBooking(
  params: CreateBookingParams
): Promise<Booking> {
  const isPeriod =
    params.type === 'PERIOD';

  let startHour: number;
  let endHour: number;
  let duration: number;

  if (isPeriod) {
    if (!params.periodShift) {
      throw new Error(
        'Selecione o período da reserva.'
      );
    }

    const periodConf =
      getPeriodConfig(
        params.periodShift,
        params.date
      );

    startHour =
      periodConf.startHour;

    endHour =
      periodConf.endHour;

    duration =
      periodConf.duration;
  } else {
    startHour =
      Number(params.hour ?? 7);

    duration =
      Number(
        params.durationHours ?? 1
      );

    endHour =
      startHour + duration;
  }

  if (
    startHour < 7 ||
    endHour > 22 ||
    endHour <= startHour
  ) {
    throw new Error(
      'A reserva deve estar entre 07:00 e 22:00.'
    );
  }

  const room =
    await getRoomRate(
      params.roomId
    );

  const hourlyRate =
    resolveHourlyRate(room);

  let totalAmount = 0;
  let periodRate:
    number | null = null;

  if (isPeriod) {
    periodRate =
      resolvePeriodRate(
        room,
        params.periodShift!
      );

    totalAmount =
      periodRate > 0
        ? periodRate
        : hourlyRate * duration;
  } else {
    totalAmount =
      hourlyRate * duration;
  }

  const hasConflict =
    await checkConflict(
      params.roomId,
      params.date,
      startHour,
      endHour
    );

  if (hasConflict) {
    throw new Error(
      'Este horário já está reservado ou bloqueado para esta sala.'
    );
  }

  let createdBookingId =
    'local-' + Date.now();

  if (isSupabaseConfigured) {
    const payload = {
      professional_id:
        params.userId,

      client_id:
        params.clientId || null,

      room_id:
        params.roomId,

      booking_date:
        params.date,

      start_time:
        startHour,

      end_time:
        endHour,

      booking_type:
        isPeriod
          ? 'PERIOD'
          : 'HOURLY',

      total_hours:
        duration,

      hourly_rate:
        hourlyRate,

      period_rate:
        periodRate,

      total_amount:
        totalAmount,

      payment_status:
        'PENDING',

      status:
        'confirmed',

      notes:
        params.notes || null,
    };

    const {
      data: created,
      error: insertError,
    } = await supabase
      .from('bookings')
      .insert(payload)
      .select('*')
      .maybeSingle();

    if (insertError) {
      console.error(
        'Erro ao criar reserva no Supabase:',
        insertError
      );

      throw new Error(
        translateSupabaseError(
          insertError
        )
      );
    }

    if (!created) {
      throw new Error(
        'O Supabase não retornou a reserva criada.'
      );
    }

    createdBookingId =
      String(created.id);

    try {
      await supabase
        .from('audit_logs')
        .insert({
          user_id:
            params.userId,

          action:
            'CREATE_BOOKING',

          entity_type:
            'booking',

          entity_id:
            createdBookingId,

          details: {
            room_id:
              params.roomId,

            booking_date:
              params.date,

            start_time:
              startHour,

            end_time:
              endHour,

            booking_type:
              isPeriod
                ? 'PERIOD'
                : 'HOURLY',

            total_amount:
              totalAmount,
          },
        });
    } catch (auditError) {
      console.warn(
        'Reserva criada, mas auditoria não foi registrada:',
        auditError
      );
    }
  }

  const newBooking: Booking = {
    id:
      createdBookingId,

    userId:
      params.userId,

    professionalId:
      params.userId,

    clientId:
      params.clientId || null,

    roomId:
      params.roomId,

    date:
      params.date,

    hour:
      startHour,

    durationHours:
      duration,

    endHour:
      endHour,

    type:
      isPeriod
        ? 'PERIOD'
        : 'HOURLY',

    periodShift:
      params.periodShift,

    hourlyRate:
      hourlyRate,

    periodRate:
      periodRate ??
      undefined,

    totalAmount:
      totalAmount,

    paymentStatus:
      'PENDING',

    status:
      'confirmed',

    notes:
      params.notes || null,

    createdAt:
      new Date().toISOString(),
  };

  const existing =
    getStoredBookings();

  const withoutDuplicate =
    existing.filter(
      booking =>
        String(booking.id) !==
        String(newBooking.id)
    );

  saveStoredBookings([
    ...withoutDuplicate,
    newBooking,
  ]);

  return newBooking;
}

/* =========================================================
   CANCELAR RESERVA
   ========================================================= */

export async function cancelBooking(
  bookingId: string,
  userId?: string,
  reason?: string
): Promise<void> {
  if (isSupabaseConfigured) {
    let query = supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        notes:
          reason || null,
      })
      .eq('id', bookingId);

    if (userId) {
      query = query.eq(
        'professional_id',
        userId
      );
    }

    const {
      error,
    } = await query;

    if (error) {
      throw new Error(
        translateSupabaseError(
          error
        )
      );
    }

    try {
      await supabase
        .from('audit_logs')
        .insert({
          user_id:
            userId || null,

          action:
            'CANCEL_BOOKING',

          entity_type:
            'booking',

          entity_id:
            bookingId,

          details: {
            reason:
              reason || null,
          },
        });
    } catch (auditError) {
      console.warn(
        'Erro ao registrar auditoria do cancelamento:',
        auditError
      );
    }
  }

  const bookings =
    getStoredBookings();

  const updated =
    bookings.map(booking =>
      String(booking.id) ===
      String(bookingId)
        ? {
            ...booking,
            status:
              'cancelled',
            notes:
              reason ||
              booking.notes ||
              null,
          }
        : booking
    );

  saveStoredBookings(updated);
}

/* =========================================================
   ATUALIZAR STATUS DE PAGAMENTO
   ========================================================= */

export async function updatePaymentStatus(
  bookingId: string,
  paymentStatus: string,
  paidAt?: string,
  paidNotes?: string,
  paidByAdmin?: string
): Promise<void> {
  const payload: any = {
    payment_status:
      paymentStatus,
  };

  if (paidAt !== undefined) {
    payload.paid_at =
      paidAt;
  }

  if (paidNotes !== undefined) {
    payload.paid_notes =
      paidNotes;
  }

  if (paidByAdmin !== undefined) {
    payload.paid_by_admin =
      paidByAdmin;
  }

  if (isSupabaseConfigured) {
    const {
      error,
    } = await supabase
      .from('bookings')
      .update(payload)
      .eq('id', bookingId);

    if (error) {
      throw new Error(
        translateSupabaseError(
          error
        )
      );
    }
  }

  const bookings =
    getStoredBookings();

  const updated =
    bookings.map(booking =>
      String(booking.id) ===
      String(bookingId)
        ? {
            ...booking,
            paymentStatus:
              paymentStatus,
          }
        : booking
    );

  saveStoredBookings(updated);
}

/* =========================================================
   EXCLUIR RESERVAS DE UM USUÁRIO
   ========================================================= */

export async function deleteBookingsByUserId(
  userId: string
): Promise<void> {
  if (isSupabaseConfigured) {
    const {
      error,
    } = await supabase
      .from('bookings')
      .delete()
      .eq(
        'professional_id',
        userId
      );

    if (error) {
      throw new Error(
        translateSupabaseError(
          error
        )
      );
    }
  }

  const filtered =
    getStoredBookings().filter(
      booking =>
        booking.userId !==
          userId &&
        booking.professionalId !==
          userId
    );

  saveStoredBookings(filtered);
}

/* =========================================================
   OBTER UMA RESERVA
   ========================================================= */

export async function getBookingById(
  bookingId: string
): Promise<Booking | null> {
  if (isSupabaseConfigured) {
    const {
      data,
      error,
    } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();

    if (!error && data) {
      return mapDbBookingToBooking(
        data
      );
    }

    if (error) {
      console.warn(
        'Erro ao buscar reserva:',
        error
      );
    }
  }

  const local =
    getStoredBookings().find(
      booking =>
        String(booking.id) ===
        String(bookingId)
    );

  return local || null;
}

/* =========================================================
   ATUALIZAR RESERVA
   ========================================================= */

export async function updateBooking(
  bookingId: string,
  updates: Partial<CreateBookingParams>
): Promise<Booking | null> {
  const current =
    await getBookingById(
      bookingId
    );

  if (!current) {
    throw new Error(
      'Reserva não encontrada.'
    );
  }

  const nextDate =
    updates.date ??
    current.date;

  const nextRoomId =
    updates.roomId ??
    current.roomId;

  const isPeriod =
    (
      updates.type ??
      current.type
    ) === 'PERIOD';

  let startHour =
    current.hour;

  let endHour =
    current.endHour;

  let duration =
    current.durationHours;

  let periodShift =
    updates.periodShift ??
    current.periodShift;

  if (isPeriod) {
    if (!periodShift) {
      throw new Error(
        'Selecione o período.'
      );
    }

    const config =
      getPeriodConfig(
        periodShift,
        nextDate
      );

    startHour =
      config.startHour;

    endHour =
      config.endHour;

    duration =
      config.duration;
  } else {
    startHour =
      Number(
        updates.hour ??
        current.hour
      );

    duration =
      Number(
        updates.durationHours ??
        current.durationHours
      );

    endHour =
      startHour +
      duration;
  }

  const conflict =
    await checkConflict(
      nextRoomId,
      nextDate,
      startHour,
      endHour,
      bookingId
    );

  if (conflict) {
    throw new Error(
      'O novo horário já está reservado ou bloqueado.'
    );
  }

  const room =
    await getRoomRate(
      nextRoomId
    );

  const hourlyRate =
    resolveHourlyRate(room);

  let totalAmount = 0;
  let periodRate:
    number | null = null;

  if (isPeriod) {
    periodRate =
      resolvePeriodRate(
        room,
        periodShift!
      );

    totalAmount =
      periodRate > 0
        ? periodRate
        : hourlyRate * duration;
  } else {
    totalAmount =
      hourlyRate * duration;
  }

  if (isSupabaseConfigured) {
    const payload = {
      professional_id:
        current.professionalId ??
        current.userId,

      client_id:
        updates.clientId !== undefined
          ? updates.clientId
          : current.clientId || null,

      room_id:
        nextRoomId,

      booking_date:
        nextDate,

      start_time:
        startHour,

      end_time:
        endHour,

      booking_type:
        isPeriod
          ? 'PERIOD'
          : 'HOURLY',

      total_hours:
        duration,

      hourly_rate:
        hourlyRate,

      period_rate:
        periodRate,

      total_amount:
        totalAmount,

      notes:
        updates.notes !== undefined
          ? updates.notes
          : current.notes || null,
    };

    const {
      data,
      error,
    } = await supabase
      .from('bookings')
      .update(payload)
      .eq('id', bookingId)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new Error(
        translateSupabaseError(
          error
        )
      );
    }

    if (data) {
      const updated =
        mapDbBookingToBooking(
          data
        );

      const local =
        getStoredBookings();

      saveStoredBookings([
        ...local.filter(
          booking =>
            String(booking.id) !==
            String(bookingId)
        ),
        updated,
      ]);

      return updated;
    }
  }

  const updated: Booking = {
    ...current,

    roomId:
      nextRoomId,

    date:
      nextDate,

    hour:
      startHour,

    durationHours:
      duration,

    endHour:
      endHour,

    type:
      isPeriod
        ? 'PERIOD'
        : 'HOURLY',

    periodShift:
      periodShift,

    hourlyRate:
      hourlyRate,

    periodRate:
      periodRate ??
      undefined,

    totalAmount:
      totalAmount,

    clientId:
      updates.clientId !== undefined
        ? updates.clientId
        : current.clientId,

    notes:
      updates.notes !== undefined
        ? updates.notes
        : current.notes,
  };

  const local =
    getStoredBookings();

  saveStoredBookings([
    ...local.filter(
      booking =>
        String(booking.id) !==
        String(bookingId)
    ),
    updated,
  ]);

  return updated;
}

/* =========================================================
   RESERVAS DO MÊS
   ========================================================= */

export async function getBookingsByMonth(
  year: number,
  month: number
): Promise<Booking[]> {
  const monthString =
    String(month).padStart(
      2,
      '0'
    );

  const prefix =
    `${year}-${monthString}`;

  const bookings =
    await getAllBookings();

  return bookings.filter(
    booking =>
      booking.date.startsWith(
        prefix
      )
  );
}

/* =========================================================
   CÁLCULO DE UTILIZAÇÃO / GASTO
   ========================================================= */

export function calculateBookingTotals(
  bookings: Booking[]
) {
  const validBookings =
    bookings.filter(
      booking =>
        booking.status !==
        'cancelled'
    );

  const totalHours =
    validBookings.reduce(
      (sum, booking) =>
        sum +
        Number(
          booking.durationHours ||
            0
        ),
      0
    );

  const totalAmount =
    validBookings.reduce(
      (sum, booking) =>
        sum +
        Number(
          booking.totalAmount ||
            0
        ),
      0
    );

  const totalBookings =
    validBookings.length;

  return {
    totalBookings,
    totalHours,
    totalAmount,
  };
}

/* =========================================================
   EXPORTAÇÕES DE COMPATIBILIDADE
   ========================================================= */

export const getBookings =
  getAllBookings;

export const getUserBookings =
  getBookingsByUserId;

/* =========================================================
   EXPORTAÇÃO DO SERVIÇO DE RESERVAS
   ========================================================= */

export const bookingService = {
  getBookings,
  getUserBookings,
  getBookingsByMonth,
  calculateBookingTotals,
};