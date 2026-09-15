import { Booking, RoomId, BookingType, PaymentStatus, BlockedSlot, SystemConfig, Room, PeriodShift } from '../types';
import { 
  getStoredBookings, saveStoredBookings, 
  getStoredBlockedSlots, saveStoredBlockedSlots, 
  getSystemConfig, saveSystemConfig, addAuditLog 
} from './storageService';
import { differenceInHours } from 'date-fns';
import { supabase, isSupabaseConfigured, translateSupabaseError } from './supabase';
import { getClosingHourForDate, SATURDAY_HOURS_END, INITIAL_PERIOD_RATES, getPeriodConfig } from '../constants';

function mapDbBookingToBooking(b: any, profilesMap?: Map<string, any>): Booking {
  const clientObj = Array.isArray(b.clients) ? b.clients[0] : b.clients;
  const profileObj = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles;
  const uid = b.professional_id || b.user_id || '';
  const profile = profilesMap?.get(uid) || profileObj;

  const hour = Number(
    b.start_time !== undefined
      ? b.start_time
      : (b.hour !== undefined ? b.hour : 7)
  );

  const duration = Number(
    b.total_hours ||
    b.duration_hours ||
    (b.end_time !== undefined ? b.end_time - hour : 1)
  );

  const endHour = Number(
    b.end_time !== undefined
      ? b.end_time
      : (b.end_time_hour !== undefined ? b.end_time_hour : hour + duration)
  );

  const price = Number(
    b.hourly_rate ||
    b.price_at_booking ||
    40.0
  );

  const total = Number(
    b.total_amount ||
    (price * duration)
  );

  const type: BookingType = (
    b.booking_type ||
    b.type ||
    (duration >= 14 ? 'PERIOD' : 'HOURLY')
  ) as BookingType;

  const paymentStatus: PaymentStatus = (
    b.payment_status ||
    (b.status === 'cancelled' ? 'CANCELLED' : 'PENDING')
  ) as PaymentStatus;

  return {
    id: String(b.id),
    userId: uid,
    userEmail: b.user_email || profile?.email || '',
    userName: b.user_name || profile?.nome || profile?.full_name || 'Profissional',
    clientId: b.client_id || undefined,
    clientName: clientObj?.full_name || b.client_name || undefined,
    roomId: (b.room_id || 'Sala 1') as RoomId,
    date: b.booking_date || b.date || '',
    hour: hour,
    durationHours: duration,
    endTimeHour: endHour,
    type: type,
    periodShift: b.period_shift || b.periodShift || undefined,
    periodName: b.period_name || b.periodName || undefined,
    priceAtBooking: price,
    totalAmount: total,
    paymentStatus: paymentStatus,
    createdAt: b.created_at || new Date().toISOString(),
    notes: b.notes || undefined,
    paidAt: b.paid_at || undefined,
    paidNotes: b.paid_notes || undefined,
    paidByAdmin: b.paid_by_admin || undefined
  };
}

function mapDbBlockToBlockedSlot(blk: any): BlockedSlot {
  return {
    id: blk.id,
    roomId: blk.room_id as RoomId | 'ALL',
    date: blk.blocked_date,
    startHour: blk.start_time,
    endHour: blk.end_time,
    reason: blk.reason,
    createdAt: blk.created_at || new Date().toISOString(),
    createdBy: blk.created_by || 'Administração'
  };
}

function mapDbRoomToRoom(r: any): Room {
  return {
    id: r.id as RoomId,
    name: r.name,
    description: r.description || '',
    hourlyRate: Number(r.hourly_rate || 40.0),
    dailyRate: Number(r.period_rate || 350.0),
    morningRate: Number(r.morning_rate || r.morningRate || INITIAL_PERIOD_RATES.MORNING),
    afternoonRate: Number(r.afternoon_rate || r.afternoonRate || INITIAL_PERIOD_RATES.AFTERNOON),
    nightRate: Number(r.night_rate || r.nightRate || INITIAL_PERIOD_RATES.NIGHT),
    status: (r.status || 'ACTIVE') as 'ACTIVE' | 'MAINTENANCE',
    openHour: Number(r.opening_time || 7),
    closeHour: Number(r.closing_time || 22),
    notes: r.notes
  };
}

export const bookingService = {
  // Retorna todos os agendamentos ativos
  getAllBookings: async (): Promise<Booking[]> => {
    if (isSupabaseConfigured) {
      try {
        const [bookRes, profRes] = await Promise.all([
          supabase.from('bookings').select('*'),
          supabase.from('profiles').select('*')
        ]);

        if (bookRes.data) {
          const profilesMap = new Map<string, any>();

          if (profRes.data) {
            profRes.data.forEach((p: any) => {
              profilesMap.set(p.id, p);
            });
          }

          const localBookings = getStoredBookings();
          const localMap = new Map<string, Booking>();

          localBookings.forEach(lb => {
            localMap.set(lb.id, lb);
          });

          const activeRemote = bookRes.data
            .filter((b: any) => {
              const status = (b.payment_status || b.status || '').toUpperCase();
              return status !== 'CANCELLED';
            })
            .map((b: any) => {
              const mapped = mapDbBookingToBooking(b, profilesMap);
              const localMatch = localMap.get(mapped.id);

              if (localMatch) {
                return {
                  ...mapped,
                  clientName: localMatch.clientName || mapped.clientName,
                  notes: localMatch.notes || mapped.notes,
                  paymentStatus: localMatch.paymentStatus || mapped.paymentStatus,
                  durationHours: localMatch.durationHours || mapped.durationHours,
                  endTimeHour: localMatch.endTimeHour || mapped.endTimeHour
                };
              }

              return mapped;
            });

          return activeRemote;
        }
      } catch (err) {
        console.warn(
          'Erro ao carregar reservas do Supabase, usando local:',
          err
        );
      }
    }

    return getStoredBookings().filter(
      b => b.paymentStatus !== 'CANCELLED'
    );
  },

  // Retorna inclusive os cancelados se necessário para auditoria
  getAllBookingsWithCancelled: async (): Promise<Booking[]> => {
    if (isSupabaseConfigured) {
      try {
        const [bookRes, profRes] = await Promise.all([
          supabase.from('bookings').select('*'),
          supabase.from('profiles').select('*')
        ]);

        if (bookRes.data) {
          const profilesMap = new Map<string, any>();

          if (profRes.data) {
            profRes.data.forEach((p: any) => {
              profilesMap.set(p.id, p);
            });
          }

          const localBookings = getStoredBookings();
          const localMap = new Map<string, Booking>();

          localBookings.forEach(lb => {
            localMap.set(lb.id, lb);
          });

          return bookRes.data.map((b: any) => {
            const mapped = mapDbBookingToBooking(b, profilesMap);
            const localMatch = localMap.get(mapped.id);

            if (localMatch) {
              return {
                ...mapped,
                clientName: localMatch.clientName || mapped.clientName,
                notes: localMatch.notes || mapped.notes,
                paymentStatus: localMatch.paymentStatus || mapped.paymentStatus,
                durationHours: localMatch.durationHours || mapped.durationHours,
                endTimeHour: localMatch.endTimeHour || mapped.endTimeHour
              };
            }

            return mapped;
          });
        }
      } catch (err) {
        console.warn(
          'Erro ao carregar todas as reservas do Supabase, usando local:',
          err
        );
      }
    }

    return getStoredBookings();
  },

  // Busca agendamentos de um profissional específico
  getBookingsByProfessional: async (
    userId: string
  ): Promise<Booking[]> => {
    if (isSupabaseConfigured) {
      try {
        const all = await bookingService.getAllBookings();
        return all.filter(b => b.userId === userId);
      } catch (err) {
        console.warn(
          'Erro ao carregar reservas do profissional do Supabase, usando local:',
          err
        );
      }
    }

    const all = getStoredBookings();
    return all.filter(b => b.userId === userId);
  },

  // Regra Crítica de Conflito
  checkConflict: async (
    roomId: RoomId,
    date: string,
    startHour: number,
    endHour: number,
    excludeBookingId?: string
  ): Promise<{ hasConflict: boolean; reason?: string }> => {

    // 0. Regra: Domingo fechado e Sábado até 14h
    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      const dayOfWeek = new Date(y, m - 1, d).getDay();

      if (dayOfWeek === 0) {
        return {
          hasConflict: true,
          reason: 'As salas não são utilizadas aos domingos.'
        };
      }

      const closingHour = getClosingHourForDate(dayOfWeek);

      if (endHour > closingHour || startHour >= closingHour) {
        return {
          hasConflict: true,
          reason:
            dayOfWeek === 6
              ? 'Aos sábados o atendimento das salas vai somente até as 14:00.'
              : `O horário de encerramento das salas neste dia é às ${closingHour}:00.`
        };
      }
    }

    // 1. Verificação no Supabase quando conectado
    if (isSupabaseConfigured) {
      try {
        // Verifica bloqueios
        const { data: blocks, error: blockErr } = await supabase
          .from('blocked_slots')
          .select('*')
          .eq('blocked_date', date);

        if (!blockErr && blocks) {
          const overlappingBlock = blocks.find(blk => {
            if (
              blk.room_id !== 'ALL' &&
              blk.room_id !== roomId
            ) {
              return false;
            }

            return (
              Math.max(startHour, blk.start_time) <
              Math.min(endHour, blk.end_time)
            );
          });

          if (overlappingBlock) {
            return {
              hasConflict: true,
              reason: `Horário bloqueado pela administração: ${overlappingBlock.reason}`
            };
          }
        }

        // Verifica reservas na data e sala
        const { data: existingBookings, error: bookErr } =
          await supabase
            .from('bookings')
            .select('*')
            .eq('room_id', roomId);

        if (!bookErr && existingBookings) {
          const dayBookings = existingBookings.filter((b: any) => {
            const bDate = b.booking_date;

            const bStatus = (
              b.payment_status ||
              b.status ||
              ''
            ).toUpperCase();

            if (bDate !== date) return false;

            if (bStatus === 'CANCELLED') return false;

            if (
              excludeBookingId &&
              String(b.id) === String(excludeBookingId)
            ) {
              return false;
            }

            return true;
          });

          for (const b of dayBookings) {
            const bStart = Number(b.start_time);
            const bEnd = Number(b.end_time);
            const bType = b.booking_type;

            if (
              Math.max(startHour, bStart) <
              Math.min(endHour, bEnd)
            ) {
              const periodLabel =
                b.period_name
                  ? ` (Período da ${b.period_name})`
                  : (
                      bType === 'PERIOD' &&
                      bEnd - bStart >= 14
                    )
                    ? ' (Período Integral)'
                    : '';

              return {
                hasConflict: true,
                reason:
                  `O horário das ${bStart}:00 às ${bEnd}:00` +
                  `${periodLabel} já está reservado nesta sala.`
              };
            }
          }

          return {
            hasConflict: false
          };
        }
      } catch (e) {
        console.warn(
          'Erro ao checar conflito no Supabase, checando local:',
          e
        );
      }
    }

    // Fallback: verificação com armazenamento local
    const allBookings = getStoredBookings().filter(
      b =>
        b.paymentStatus !== 'CANCELLED' &&
        (!excludeBookingId || b.id !== excludeBookingId)
    );

    const allBlocks = getStoredBlockedSlots();

    // Verifica bloqueios administrativos
    const overlappingBlock = allBlocks.find(blk => {
      if (blk.date !== date) return false;

      if (
        blk.roomId !== 'ALL' &&
        blk.roomId !== roomId
      ) {
        return false;
      }

      return (
        Math.max(startHour, blk.startHour) <
        Math.min(endHour, blk.endHour)
      );
    });

    if (overlappingBlock) {
      return {
        hasConflict: true,
        reason:
          `Horário bloqueado pela administração: ${overlappingBlock.reason}`
      };
    }

    // Verifica reservas existentes na mesma sala e data
    const sameDayRoomBookings = allBookings.filter(
      b =>
        b.roomId === roomId &&
        b.date === date
    );

    for (const b of sameDayRoomBookings) {
      const bEnd =
        b.endTimeHour ||
        (b.hour + (b.durationHours || 1));

      if (
        Math.max(startHour, b.hour) <
        Math.min(endHour, bEnd)
      ) {
        const periodLabel = b.periodName
          ? ` (Período da ${b.periodName})`
          : (
              b.type === 'PERIOD' &&
              bEnd - b.hour >= 14
            )
            ? ' (Período Integral)'
            : '';

        return {
          hasConflict: true,
          reason:
            `O horário das ${b.hour}:00 às ${bEnd}:00` +
            `${periodLabel} já está reservado nesta sala.`
        };
      }
    }

    return {
      hasConflict: false
    };
  },

  // Criação da locação com congelamento de valores
  createBooking: async (params: {
    userId: string;
    userEmail: string;
    userName: string;
    clientId?: string;
    clientName?: string;
    roomId: RoomId;
    date: string;
    hour: number;
    durationHours?: number;
    type?: BookingType;
    periodShift?: PeriodShift;
    periodName?: string;
    notes?: string;
  }): Promise<Booking> => {

    let hourlyRate = 40.0;
    let periodRate = 350.0;
    let morningRate = INITIAL_PERIOD_RATES.MORNING;
    let afternoonRate = INITIAL_PERIOD_RATES.AFTERNOON;
    let nightRate = INITIAL_PERIOD_RATES.NIGHT;
    let openHour = 7;
    let closeHour = 22;

    // Busca tarifas e horários das salas
    if (isSupabaseConfigured) {
      try {
        const { data: roomData } = await supabase
          .from('rooms')
          .select('*')
          .eq('id', params.roomId)
          .maybeSingle();

        if (roomData) {
          hourlyRate = Number(roomData.hourly_rate);
          periodRate = Number(roomData.period_rate);

          if (roomData.morning_rate) {
            morningRate = Number(roomData.morning_rate);
          }

          if (roomData.afternoon_rate) {
            afternoonRate = Number(roomData.afternoon_rate);
          }

          if (roomData.night_rate) {
            nightRate = Number(roomData.night_rate);
          }

          openHour = Number(roomData.opening_time);
          closeHour = Number(roomData.closing_time);
        }
      } catch (e) {
        console.warn(
          'Erro ao obter tarifas da sala no Supabase:',
          e
        );
      }
    } else {
      const config = getSystemConfig();
      const room = config.rooms.find(
        r => r.id === params.roomId
      );

      if (room) {
        hourlyRate = room.hourlyRate;
        periodRate = room.dailyRate;

        if (room.morningRate) {
          morningRate = room.morningRate;
        }

        if (room.afternoonRate) {
          afternoonRate = room.afternoonRate;
        }

        if (room.nightRate) {
          nightRate = room.nightRate;
        }

        openHour = room.openHour;
        closeHour = room.closeHour;
      }
    }

    const isPeriod = params.type === 'PERIOD';

    const periodShift: PeriodShift =
      params.periodShift || 'MORNING';

    const periodConf = getPeriodConfig(
      periodShift,
      params.date
    );

    const startHour = isPeriod
      ? periodConf.startHour
      : params.hour;

    const duration = isPeriod
      ? periodConf.duration
      : (params.durationHours || 1);

    const endHour = startHour + duration;

    const periodName =
      params.periodName || periodConf.name;

    // 1. Validação estrita de conflito
    const conflict =
      await bookingService.checkConflict(
        params.roomId,
        params.date,
        startHour,
        endHour
      );

    if (conflict.hasConflict) {
      throw new Error(
        conflict.reason ||
        'Este horário não está mais disponível.'
      );
    }

    // 2. Cálculo financeiro
    const priceAtBooking = hourlyRate;

    let totalAmount = 0;

    if (isPeriod) {
      if (periodShift === 'MORNING') {
        totalAmount = morningRate;

      } else if (periodShift === 'AFTERNOON') {
        const isSat =
          getClosingHourForDate(params.date) ===
          SATURDAY_HOURS_END;

        totalAmount = isSat
          ? Math.round(afternoonRate * (2 / 6))
          : afternoonRate;

      } else if (periodShift === 'NIGHT') {
        totalAmount = nightRate;

      } else {
        totalAmount = periodRate;
      }

    } else {
      totalAmount = duration * hourlyRate;
    }

    // 3. Persistência no Supabase
    //
    // IMPORTANTE:
    // A tabela bookings REAL possui:
    // professional_id
    // client_id
    // room_id
    // booking_date
    // start_time
    // end_time
    // booking_type
    // total_hours
    // hourly_rate
    // period_rate
    // total_amount
    // payment_status
    // status
    // notes

    let createdBookingId = 'bk-' + Date.now();

    if (isSupabaseConfigured) {
      try {
        const payload = {
          professional_id: params.userId,
          client_id: params.clientId || null,
          room_id: params.roomId,
          booking_date: params.date,
          start_time: startHour,
          end_time: endHour,
          booking_type: isPeriod
            ? 'PERIOD'
            : 'HOURLY',
          total_hours: duration,
          hourly_rate: hourlyRate,
          period_rate: isPeriod
            ? totalAmount
            : null,
          total_amount: totalAmount,
          payment_status: 'PENDING',
          status: 'confirmed',
          notes: params.notes || null
        };

        const {
          data: created,
          error
        } = await supabase
          .from('bookings')
          .insert(payload)
          .select()
          .single();

        if (error) {
          throw error;
        }

        if (created) {
          createdBookingId = String(created.id);
        }

        // Auditoria
        try {
          await supabase
            .from('audit_logs')
            .insert({
              user_id: params.userId,
              user_name: params.userName,
              action: 'Nova Reserva',
              details:
                `Locação criada: ${params.roomId}, ` +
                `${params.date} das ${startHour}:00 às ` +
                `${endHour}:00 ` +
                `(${isPeriod ? `Período da ${periodName}` : `${duration}h`}) ` +
                `(Total: R$ ${totalAmount.toFixed(2)})`
            });
        } catch (auditError) {
          console.warn(
            'Aviso ao registrar auditoria:',
            auditError
          );
        }

      } catch (err: any) {
        console.error(
          'Erro ao criar reserva no Supabase:',
          err
        );

        throw new Error(
          translateSupabaseError(err)
        );
      }
    }

    // 4. Representação local da reserva
    const newBooking: Booking = {
      id: createdBookingId,
      userId: params.userId,
      userEmail: params.userEmail,
      userName: params.userName,
      clientId: params.clientId,
      clientName: params.clientName,
      roomId: params.roomId,
      date: params.date,
      hour: startHour,
      durationHours: duration,
      endTimeHour: endHour,
      type: isPeriod
        ? 'PERIOD'
        : 'HOURLY',
      periodShift: isPeriod
        ? periodShift
        : undefined,
      periodName: isPeriod
        ? periodName
        : undefined,
      priceAtBooking,
      totalAmount,
      paymentStatus: 'PENDING',
      createdAt: new Date().toISOString(),
      notes: params.notes
    };

    const current = getStoredBookings();

    saveStoredBookings([
      newBooking,
      ...current.filter(
        b => b.id !== newBooking.id
      )
    ]);

    addAuditLog(
      params.userId,
      params.userName,
      'Nova Reserva',
      `Locação criada: ${params.roomId}, ` +
      `${params.date} das ${startHour}:00 às ` +
      `${endHour}:00 ` +
      `(${isPeriod ? `Período da ${periodName}` : `${duration}h`}) ` +
      `(Total: R$ ${totalAmount.toFixed(2)})`
    );

    return newBooking;
  },

  // Cancelamento de locação
  cancelBooking: async (
    bookingId: string,
    user: {
      id: string;
      name: string;
      role: string;
    }
  ): Promise<void> => {

    const isAdmin = user.role === 'ADMIN';

    if (isSupabaseConfigured) {
      try {
        const {
          data: target,
          error: fetchErr
        } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', bookingId)
          .single();

        if (fetchErr || !target) {
          throw new Error(
            'Reserva não encontrada.'
          );
        }

        if (
          !isAdmin &&
          target.professional_id !== user.id
        ) {
          throw new Error(
            'Você só pode cancelar suas próprias reservas.'
          );
        }

        if (!isAdmin) {
          const bookingStartTime =
            new Date(
              `${target.booking_date}T` +
              `${target.start_time
                .toString()
                .padStart(2, '0')}:00:00`
            );

          const hoursDiff =
            differenceInHours(
              bookingStartTime,
              new Date()
            );

          if (hoursDiff < 24) {
            throw new Error(
              'Cancelamentos só podem ser realizados com no mínimo 24h de antecedência do horário agendado.'
            );
          }
        }

        const {
          error: updateErr
        } = await supabase
          .from('bookings')
          .update({
            payment_status: 'CANCELLED',
            status: 'cancelled'
          })
          .eq('id', bookingId);

        if (updateErr) {
          throw updateErr;
        }

        await supabase
          .from('audit_logs')
          .insert({
            user_id: user.id,
            user_name: user.name,
            action: 'Cancelamento de Reserva',
            details:
              `Reserva ${bookingId} ` +
              `(${target.room_id}, ${target.booking_date}) ` +
              `foi cancelada.`
          });

        return;

      } catch (err: any) {
        throw new Error(
          translateSupabaseError(err)
        );
      }
    }

    const bookings = getStoredBookings();

    const index = bookings.findIndex(
      b => b.id === bookingId
    );

    if (index === -1) {
      throw new Error(
        'Reserva não encontrada.'
      );
    }

    const target = bookings[index];

    if (
      !isAdmin &&
      target.userId !== user.id
    ) {
      throw new Error(
        'Você só pode cancelar suas próprias reservas.'
      );
    }

    if (!isAdmin) {
      const config = getSystemConfig();

      const limitHours =
        config.cancellationLimitHours ?? 24;

      const bookingStartTime =
        new Date(
          `${target.date}T` +
          `${target.hour
            .toString()
            .padStart(2, '0')}:00:00`
        );

      const hoursDiff =
        differenceInHours(
          bookingStartTime,
          new Date()
        );

      if (hoursDiff < limitHours) {
        throw new Error(
          `Cancelamentos só podem ser realizados com no mínimo ${limitHours}h de antecedência do horário agendado.`
        );
      }
    }

    bookings[index] = {
      ...target,
      paymentStatus: 'CANCELLED'
    };

    saveStoredBookings(bookings);

    addAuditLog(
      user.id,
      user.name,
      'Cancelamento de Reserva',
      `Reserva ${bookingId} ` +
      `(${target.roomId}, ${target.date}) ` +
      `foi cancelada.`
    );
  },

  // Atualização do status de pagamento
  updatePaymentStatus: async (params: {
    bookingId: string;
    newStatus: PaymentStatus;
    adminUser: {
      id: string;
      name: string;
    };
    paidNotes?: string;
  }): Promise<Booking> => {

    if (isSupabaseConfigured) {
      try {
        const payload: any = {
          payment_status: params.newStatus,
          paid_notes: params.paidNotes,
          paid_by_admin: params.adminUser.name,
          paid_at:
            params.newStatus === 'PAID'
              ? new Date().toISOString()
              : null
        };

        const {
          data: updated,
          error
        } = await supabase
          .from('bookings')
          .update(payload)
          .eq('id', params.bookingId)
          .select(
            '*, clients(full_name), profiles:professional_id(full_name, email)'
          )
          .single();

        if (error) {
          throw error;
        }

        if (
          params.newStatus === 'PAID' &&
          updated
        ) {
          await supabase
            .from('payments')
            .insert({
              booking_id: updated.id,
              professional_id: updated.professional_id,
              amount: updated.total_amount,
              payment_date:
                new Date()
                  .toISOString()
                  .split('T')[0],
              status: 'PAID',
              notes:
                params.paidNotes ||
                'Pagamento confirmado pelo administrador',
              created_by:
                params.adminUser.name
            });
        }

        await supabase
          .from('audit_logs')
          .insert({
            user_id: params.adminUser.id,
            user_name: params.adminUser.name,
            action: 'Controle Financeiro / Pagamento',
            details:
              `Reserva ${params.bookingId} ` +
              `alterada para status: ` +
              `${params.newStatus}.`
          });

        return mapDbBookingToBooking(
          updated
        );

      } catch (err: any) {
        throw new Error(
          translateSupabaseError(err)
        );
      }
    }

    const bookings = getStoredBookings();

    const index = bookings.findIndex(
      b => b.id === params.bookingId
    );

    if (index === -1) {
      throw new Error(
        'Reserva não encontrada.'
      );
    }

    const target = bookings[index];

    const updated: Booking = {
      ...target,
      paymentStatus: params.newStatus,
      paidAt:
        params.newStatus === 'PAID'
          ? new Date().toISOString()
          : undefined,
      paidNotes: params.paidNotes,
      paidByAdmin:
        params.adminUser.name
    };

    bookings[index] = updated;

    saveStoredBookings(bookings);

    addAuditLog(
      params.adminUser.id,
      params.adminUser.name,
      'Controle Financeiro / Pagamento',
      `Reserva ${params.bookingId} ` +
      `(${target.userName}) alterada ` +
      `para status: ${params.newStatus}.`
    );

    return updated;
  },

  // Gerenciamento de Bloqueios Administrativos
  getBlockedSlots: async (): Promise<BlockedSlot[]> => {
    if (isSupabaseConfigured) {
      try {
        const {
          data,
          error
        } = await supabase
          .from('blocked_slots')
          .select('*')
          .order(
            'blocked_date',
            { ascending: true }
          );

        if (error) {
          throw error;
        }

        if (data) {
          return data.map(
            mapDbBlockToBlockedSlot
          );
        }

      } catch (err) {
        console.warn(
          'Erro ao carregar bloqueios do Supabase, usando local:',
          err
        );
      }
    }

    return getStoredBlockedSlots();
  },

  createBlockedSlot: async (
    slotData: Omit<
      BlockedSlot,
      'id' | 'createdAt'
    >,
    adminUser: {
      id: string;
      name: string;
    }
  ): Promise<BlockedSlot> => {

    if (slotData.date) {
      const [y, m, d] =
        slotData.date
          .split('-')
          .map(Number);

      if (
        new Date(
          y,
          m - 1,
          d
        ).getDay() === 0
      ) {
        throw new Error(
          'As salas já não são utilizadas aos domingos.'
        );
      }
    }

    if (isSupabaseConfigured) {
      try {
        const payload = {
          room_id: slotData.roomId,
          blocked_date: slotData.date,
          start_time: slotData.startHour,
          end_time: slotData.endHour,
          reason: slotData.reason,
          created_by: adminUser.name
        };

        const {
          data: created,
          error
        } = await supabase
          .from('blocked_slots')
          .insert(payload)
          .select()
          .single();

        if (error) {
          throw error;
        }

        await supabase
          .from('audit_logs')
          .insert({
            user_id: adminUser.id,
            user_name: adminUser.name,
            action: 'Bloqueio de Horário',
            details:
              `Bloqueio criado para ` +
              `${slotData.roomId} em ` +
              `${slotData.date} ` +
              `(${slotData.startHour}h-${slotData.endHour}h): ` +
              `${slotData.reason}`
          });

        return mapDbBlockToBlockedSlot(
          created
        );

      } catch (err: any) {
        throw new Error(
          translateSupabaseError(err)
        );
      }
    }

    const blocks =
      getStoredBlockedSlots();

    const newBlock: BlockedSlot = {
      ...slotData,
      id: 'blk-' + Date.now(),
      createdAt:
        new Date().toISOString()
    };

    saveStoredBlockedSlots([
      newBlock,
      ...blocks
    ]);

    addAuditLog(
      adminUser.id,
      adminUser.name,
      'Bloqueio de Horário',
      `Bloqueio criado para ` +
      `${slotData.roomId} em ` +
      `${slotData.date} ` +
      `(${slotData.startHour}h-${slotData.endHour}h): ` +
      `${slotData.reason}`
    );

    return newBlock;
  },

  deleteBlockedSlot: async (
    blockId: string,
    adminUser: {
      id: string;
      name: string;
    }
  ): Promise<void> => {

    if (isSupabaseConfigured) {
      try {
        const { error } =
          await supabase
            .from('blocked_slots')
            .delete()
            .eq('id', blockId);

        if (error) {
          throw error;
        }

        await supabase
          .from('audit_logs')
          .insert({
            user_id: adminUser.id,
            user_name: adminUser.name,
            action: 'Remoção de Bloqueio',
            details:
              `Bloqueio ${blockId} foi desativado.`
          });

        return;

      } catch (err: any) {
        throw new Error(
          translateSupabaseError(err)
        );
      }
    }

    const blocks =
      getStoredBlockedSlots();

    const filtered =
      blocks.filter(
        b => b.id !== blockId
      );

    saveStoredBlockedSlots(
      filtered
    );

    addAuditLog(
      adminUser.id,
      adminUser.name,
      'Remoção de Bloqueio',
      `Bloqueio ${blockId} foi desativado.`
    );
  },

  // Gerenciamento das Salas e Tarifas
  getRooms: async (): Promise<Room[]> => {
    if (isSupabaseConfigured) {
      try {
        const {
          data,
          error
        } = await supabase
          .from('rooms')
          .select('*')
          .order(
            'id',
            { ascending: true }
          );

        if (
          !error &&
          data &&
          data.length > 0
        ) {
          return data.map(
            mapDbRoomToRoom
          );
        }

      } catch (e) {
        console.warn(
          'Erro ao buscar salas no Supabase, usando local:',
          e
        );
      }
    }

    const config =
      getSystemConfig();

    return config.rooms;
  },

  updateRoomRates: async (
    roomId: RoomId,
    hourlyRate: number,
    dailyRate: number,
    adminUser: {
      id: string;
      name: string;
    },
    morningRate?: number,
    afternoonRate?: number,
    nightRate?: number
  ): Promise<void> => {

    if (isSupabaseConfigured) {
      try {
        const updatePayload: any = {
          hourly_rate: hourlyRate,
          period_rate: dailyRate
        };

        if (
          morningRate !== undefined
        ) {
          updatePayload.morning_rate =
            morningRate;
        }

        if (
          afternoonRate !== undefined
        ) {
          updatePayload.afternoon_rate =
            afternoonRate;
        }

        if (
          nightRate !== undefined
        ) {
          updatePayload.night_rate =
            nightRate;
        }

        const { error } =
          await supabase
            .from('rooms')
            .update(updatePayload)
            .eq('id', roomId);

        if (error) {
          throw error;
        }

        await supabase
          .from('audit_logs')
          .insert({
            user_id: adminUser.id,
            user_name: adminUser.name,
            action: 'Alteração de Preço',
            details:
              `Novos valores para ${roomId}: ` +
              `Hora R$ ${hourlyRate.toFixed(2)} | ` +
              `Manhã R$ ${(morningRate || 150).toFixed(2)} | ` +
              `Tarde R$ ${(afternoonRate || 180).toFixed(2)} | ` +
              `Noite R$ ${(nightRate || 130).toFixed(2)}`
          });

      } catch (err: any) {
        throw new Error(
          translateSupabaseError(err)
        );
      }
    }

    const config =
      getSystemConfig();

    const room =
      config.rooms.find(
        r => r.id === roomId
      );

    if (!room) {
      throw new Error(
        'Sala não encontrada.'
      );
    }

    room.hourlyRate =
      hourlyRate;

    room.dailyRate =
      dailyRate;

    if (
      morningRate !== undefined
    ) {
      room.morningRate =
        morningRate;
    }

    if (
      afternoonRate !== undefined
    ) {
      room.afternoonRate =
        afternoonRate;
    }

    if (
      nightRate !== undefined
    ) {
      room.nightRate =
        nightRate;
    }

    saveSystemConfig(config);

    addAuditLog(
      adminUser.id,
      adminUser.name,
      'Alteração de Preço',
      `Novos valores para ${roomId}: ` +
      `Hora R$ ${hourlyRate.toFixed(2)} | ` +
      `Manhã R$ ${(room.morningRate || 150).toFixed(2)} | ` +
      `Tarde R$ ${(room.afternoonRate || 180).toFixed(2)} | ` +
      `Noite R$ ${(room.nightRate || 130).toFixed(2)}`
    );
  },

  // Helpers de Configuração Global
  getCurrentHourlyRate: async (
    roomId: RoomId = 'Sala 1'
  ): Promise<number> => {

    if (isSupabaseConfigured) {
      try {
        const { data } =
          await supabase
            .from('rooms')
            .select('hourly_rate')
            .eq('id', roomId)
            .maybeSingle();

        if (data?.hourly_rate) {
          return Number(
            data.hourly_rate
          );
        }

      } catch (e) {}
    }

    const config =
      getSystemConfig();

    const room =
      config.rooms.find(
        r => r.id === roomId
      );

    return room
      ? room.hourlyRate
      : 40.0;
  },

  getUnblockedHolidays:
    async (): Promise<string[]> => {
      const config =
        getSystemConfig();

      return config.unblockedHolidays || [];
    },

  isGlobalHolidaysAllowed:
    async (): Promise<boolean> => {
      const config =
        getSystemConfig();

      return !!config.allowHolidaysGlobal;
    },

  toggleGlobalHolidays:
    async (): Promise<boolean> => {
      const config =
        getSystemConfig();

      config.allowHolidaysGlobal =
        !config.allowHolidaysGlobal;

      saveSystemConfig(config);

      return config.allowHolidaysGlobal;
    },

  toggleHolidayStatus:
    async (
      dateKey: string
    ): Promise<string[]> => {

      const config =
        getSystemConfig();

      const current =
        config.unblockedHolidays || [];

      const newList =
        current.includes(dateKey)
          ? current.filter(
              d => d !== dateKey
            )
          : [
              ...current,
              dateKey
            ];

      config.unblockedHolidays =
        newList;

      saveSystemConfig(config);

      return newList;
    },

  deleteBookingsByUserId:
    async (
      userId: string
    ): Promise<void> => {

      if (isSupabaseConfigured) {
        try {
          await supabase
            .from('bookings')
            .delete()
            .eq(
              'professional_id',
              userId
            );
        } catch (e) {}
      }

      const bookings =
        getStoredBookings();

      const filtered =
        bookings.filter(
          b => b.userId !== userId
        );

      saveStoredBookings(
        filtered
      );
    }
};