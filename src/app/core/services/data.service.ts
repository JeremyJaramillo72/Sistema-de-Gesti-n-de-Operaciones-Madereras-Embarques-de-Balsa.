import { Injectable, signal, computed, inject } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import {
  Trabajador,
  DescargaMadera,
  EmbarqueTrailer,
  MovimientoLiquidacion,
  FiltroReporte,
  ResumenReporte
} from '../models/boya.models';

const STORAGE_KEYS = {
  TRABAJADORES: 'boya_trabajadores',
  DESCARGAS: 'boya_descargas',
  EMBARQUES: 'boya_embarques'
};

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private supabase: SupabaseClient | null = null;
  public authService = inject(AuthService);
  public isUsingSupabase = signal<boolean>(false);
  public isConnected = signal<boolean>(false);

  // Signals reactivas para el estado de la app
  public trabajadores = signal<Trabajador[]>([]);
  public descargas = signal<DescargaMadera[]>([]);
  public embarques = signal<EmbarqueTrailer[]>([]);
  public cargando = signal<boolean>(false);

  // Lista unificada de trabajadores que garantiza incluir siempre al usuario en sesión
  public todosLosTrabajadores = computed<Trabajador[]>(() => {
    const lista = [...this.trabajadores()];
    const user = this.authService.usuarioActual();
    if (user) {
      const uNom = (user.nombre || '').trim().toLowerCase();
      const uUser = (user.usuario || '').trim().toLowerCase();
      const yaExiste = lista.some(
        t => (t.nombre || '').trim().toLowerCase() === uNom || 
             (t.alias || '').trim().toLowerCase() === uUser ||
             t.id.toLowerCase() === ('trab_' + uUser.replace(/\s+/g, '_'))
      );
      if (!yaExiste) {
        lista.push({
          id: 'trab_' + uUser.replace(/\s+/g, '_'),
          nombre: user.nombre.trim(),
          alias: user.usuario.trim(),
          activo: user.activo !== false,
          usuario_id: user.id,
          usuario_creador: user.usuario
        });
      }
    }
    return lista;
  });

  // Lista de trabajadores visibles estrictamente para el usuario en sesión
  public misTrabajadores = computed<Trabajador[]>(() => {
    const user = this.authService.usuarioActual();
    if (!user) return [];

    const uId = user.id.toLowerCase().trim();
    const uUser = user.usuario.toLowerCase().trim();
    const esAdmin = this.authService.esAdmin();
    const listaOriginal = this.todosLosTrabajadores();

    return listaOriginal.filter(t => {
      // 1. Si es la ficha personal del usuario en sesión
      if (this.authService.esMiTrabajador(t)) return true;

      const regId = (t.usuario_id || '').toLowerCase().trim();
      const regUser = (t.usuario_creador || '').toLowerCase().trim();

      // 2. Si es el Administrador Jeremy: ve a su cuadrilla oficial del patio
      // pero NO ve los ayudantes creados por otros usuarios (ej. Ramona de Marco)
      if (esAdmin) {
        if (!regUser && !regId) return true;
        if (regUser === 'jeremy' || regId === 'usr_admin_jeremy') return true;
        return false;
      }

      // 3. Para el rol USUARIO: ve los trabajadores que él mismo agregó
      if (regId && regId === uId) return true;
      if (regUser && regUser === uUser) return true;

      return false;
    });
  });

  // Ayudantes registrados por otros usuarios (visible para que el Admin pueda auditar/gestionar)
  public ayudantesDeOtrosUsuarios = computed<Trabajador[]>(() => {
    const listaOriginal = this.todosLosTrabajadores();
    return listaOriginal.filter(t => {
      const regUser = (t.usuario_creador || '').toLowerCase().trim();
      const regId = (t.usuario_id || '').toLowerCase().trim();
      if (!regUser && !regId) return false;
      if (regUser === 'jeremy' || regId === 'usr_admin_jeremy') return false;
      if (this.authService.esMiTrabajador(t)) return false;
      return true;
    });
  });

  // Trabajadores disponibles para seleccionar en formularios de faena (descargas y embarques)
  // Incluye la cuadrilla general del patio + los ayudantes particulares del usuario en sesión
  public trabajadoresParaFaena = computed<Trabajador[]>(() => {
    const user = this.authService.usuarioActual();
    if (!user) return [];

    const uId = user.id.toLowerCase().trim();
    const uUser = user.usuario.toLowerCase().trim();
    const listaOriginal = this.todosLosTrabajadores();

    return listaOriginal.filter(t => {
      // 1. Trabajadores oficiales de patio (sin creador o de Jeremy)
      const regUser = (t.usuario_creador || '').toLowerCase().trim();
      const regId = (t.usuario_id || '').toLowerCase().trim();
      const esPatio = (!regUser && !regId) || regUser === 'jeremy' || regId === 'usr_admin_jeremy';
      if (esPatio) return true;

      // 2. Es el propio usuario
      if (this.authService.esMiTrabajador(t)) return true;

      // 3. Es un ayudante particular creado por el usuario en sesión
      if ((regId && regId === uId) || (regUser && regUser === uUser)) return true;

      return false;
    });
  });

  /**
   * Determina si un registro (descarga o embarque) pertenece estrictamente al usuario en sesión
   */
  public esMiRegistro(item: { usuario_id?: string; usuario_creador?: string } | null | undefined): boolean {
    if (!item) return false;
    const user = this.authService.usuarioActual();
    if (!user) return false;

    const uId = user.id.toLowerCase().trim();
    const uUser = user.usuario.toLowerCase().trim();

    const regId = (item.usuario_id || '').toLowerCase().trim();
    const regUser = (item.usuario_creador || '').toLowerCase().trim();

    // 1. Coincidencia por ID de usuario creador
    if (regId && regId === uId) {
      return true;
    }

    // 2. Coincidencia por username creador
    if (regUser && regUser === uUser) {
      return true;
    }

    // Si tiene creador explícito y no coincide con el usuario actual, NO es de él
    if (regId || regUser) {
      return false;
    }

    // 3. Registros históricos / legacy sin creador explícito pertenecen al Administrador Jeremy
    return uUser === 'jeremy';
  }

  public parseCreatorTag(rawObs?: string): { usuario_id: string; usuario_creador: string; obsLimpia: string } {
    const text = rawObs || '';
    const match = text.match(/<!--uid:(.*?)\|usr:(.*?)-->/);
    if (match) {
      return {
        usuario_id: match[1],
        usuario_creador: match[2],
        obsLimpia: text.replace(/<!--uid:.*?\|usr:.*?-->/g, '').replace(/<!--usr_auth:.*?-->/g, '').trim()
      };
    }
    const authMatch = text.match(/<!--usr_auth:(.*?)-->/);
    if (authMatch) {
      try {
        const parsed = JSON.parse(authMatch[1]);
        if (parsed.usuario) {
          return {
            usuario_id: parsed.id || ('usr_' + parsed.usuario),
            usuario_creador: parsed.usuario,
            obsLimpia: text.replace(/<!--usr_auth:.*?-->/g, '').trim()
          };
        }
      } catch (e) {}
    }
    return {
      usuario_id: 'usr_admin_jeremy',
      usuario_creador: 'Jeremy',
      obsLimpia: text.replace(/<!--usr_auth:.*?-->/g, '').trim()
    };
  }

  public buildCreatorTag(obs: string | undefined, userId: string, usuario: string): { obsConTag: string; obsLimpia: string } {
    const raw = obs || '';
    const authMatch = raw.match(/<!--usr_auth:(.*?)-->/);
    const authTag = authMatch ? ` ${authMatch[0]}` : '';

    const limpia = raw.replace(/<!--uid:.*?\|usr:.*?-->/g, '').replace(/<!--usr_auth:.*?-->/g, '').trim();
    const tag = `<!--uid:${userId}|usr:${usuario}-->`;
    return {
      obsConTag: (limpia ? `${limpia} ${tag}` : tag) + authTag,
      obsLimpia: limpia
    };
  }

  // Registros reactivos filtrados estrictamente para el usuario actual
  public misDescargas = computed(() =>
    this.descargas().filter(d => this.esMiRegistro(d))
  );

  public misEmbarques = computed(() =>
    this.embarques().filter(e => this.esMiRegistro(e))
  );

  // Totales computados estrictamente para el usuario actual
  public totalCarrosDescargados = computed(() =>
    this.misDescargas().reduce((acc, d) => acc + Number(d.cantidad_carros || 0), 0)
  );

  public totalTrailersEmbarcados = computed(() =>
    this.misEmbarques().reduce((acc, e) => acc + Number(e.cantidad_trailers || 0), 0)
  );

  public totalPendienteCobro = computed(() => {
    const esAdmin = this.authService.esAdmin();
    let pendiente = 0;

    // Para el ADMIN: Jeremy NO paga las descargas de carros de boya (se pagan directamente por el vehículo/proveedor).
    // Solo se suman las descargas si es un USUARIO individual consultando sus ingresos personales.
    if (!esAdmin) {
      for (const d of this.misDescargas()) {
        const trabs = d.trabajadores || [];
        const mi = trabs.find(t => this.authService.esMiTrabajador(t)) || (trabs.length > 0 ? trabs[0] : null);
        if (mi && !mi.pagado) {
          pendiente += Number(mi.monto_individual || 0);
        }
      }
    }

    // Embarques de Tráilers (despachos de balsa a fábrica que Jeremy SÍ liquida a la cuadrilla a $7/pers)
    for (const e of this.misEmbarques()) {
      if (esAdmin) {
        for (const t of e.trabajadores || []) {
          if (!t.pagado) pendiente += Number(t.monto_individual || 0);
        }
      } else {
        const trabs = e.trabajadores || [];
        const mi = trabs.find(t => this.authService.esMiTrabajador(t)) || (trabs.length > 0 ? trabs[0] : null);
        if (mi && !mi.pagado) {
          pendiente += Number(mi.monto_individual || 0);
        }
      }
    }

    return pendiente;
  });

  public totalPagadoHistorico = computed(() => {
    const esAdmin = this.authService.esAdmin();
    let pagado = 0;

    if (!esAdmin) {
      for (const d of this.misDescargas()) {
        const trabs = d.trabajadores || [];
        const mi = trabs.find(t => this.authService.esMiTrabajador(t)) || (trabs.length > 0 ? trabs[0] : null);
        if (mi && mi.pagado) {
          pagado += Number(mi.monto_individual || 0);
        }
      }
    }

    for (const e of this.misEmbarques()) {
      if (esAdmin) {
        for (const t of e.trabajadores || []) {
          if (t.pagado) pagado += Number(t.monto_individual || 0);
        }
      } else {
        const trabs = e.trabajadores || [];
        const mi = trabs.find(t => this.authService.esMiTrabajador(t)) || (trabs.length > 0 ? trabs[0] : null);
        if (mi && mi.pagado) {
          pagado += Number(mi.monto_individual || 0);
        }
      }
    }

    return pagado;
  });

  constructor() {
    this.initClient();
    this.cargarDatos();
  }

  private initClient() {
    if (environment.supabaseUrl && environment.supabaseAnonKey && environment.supabaseUrl.startsWith('http')) {
      try {
        this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
        this.isUsingSupabase.set(true);
        this.isConnected.set(true);
      } catch (err) {
        console.warn('Error inicializando Supabase, usando almacenamiento local:', err);
        this.isUsingSupabase.set(false);
      }
    } else {
      this.isUsingSupabase.set(false);
    }
  }

  public async cargarDatos() {
    this.cargando.set(true);
    try {
      if (this.isUsingSupabase() && this.supabase) {
        await this.cargarDesdeSupabase();
      } else {
        this.cargarDesdeLocalStorage();
      }
    } catch (err) {
      console.error('Error cargando datos:', err);
      this.cargarDesdeLocalStorage();
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Ejecuta una promesa o llamada de Supabase con tiempo límite de 7.5s.
   * Evita bloqueos indefinidos cuando la señal celular o internet es deficiente.
   */
  public async ejecutarConTimeout(promesa: any, ms = 7500): Promise<any> {
    let timeoutId: any;
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => {
        console.warn(`[DataService] Solicitud Supabase excedió ${ms}ms por baja señal. Resguardando localmente.`);
        resolve(null);
      }, ms);
    });

    try {
      const res = await Promise.race([Promise.resolve(promesa), timeoutPromise]);
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('[DataService] Error o corte de red en Supabase:', err);
      return null;
    }
  }

  // ==========================================
  // CARGA DESDE SUPABASE
  // ==========================================
  private async cargarDesdeSupabase() {
    if (!this.supabase) return;

    // 1. Trabajadores
    const { data: trabData } = await this.supabase
      .from('trabajadores')
      .select('*')
      .order('nombre', { ascending: true });

    let listaTrab: Trabajador[] = trabData && trabData.length > 0
      ? trabData.map(t => {
          const parsed = this.parseCreatorTag(t.telefono);
          return {
            ...t,
            telefono: parsed.obsLimpia,
            usuario_id: t.usuario_id || parsed.usuario_id,
            usuario_creador: t.usuario_creador || parsed.usuario_creador
          };
        })
      : [];
    if (listaTrab.length === 0) {
      // Si está vacía en Supabase, cargar semillas
      await this.sembrarSupabase();
      listaTrab = this.generarTrabajadoresSemilla();
    }

    this.trabajadores.set(listaTrab);

    // 2. Descargas con detalle de trabajadores
    const { data: descData } = await this.supabase
      .from('descargas_madera')
      .select(`
        *,
        trabajadores:descarga_trabajadores (
          *,
          trabajador:trabajadores (nombre, alias)
        )
      `)
      .order('fecha', { ascending: false });

    if (descData) {
      const mapeadas: DescargaMadera[] = descData.map((d: any) => {
        const parsed = this.parseCreatorTag(d.observaciones);
        return {
          id: d.id,
          fecha: d.fecha,
          cantidad_carros: d.cantidad_carros,
          filas_por_carro: d.filas_por_carro,
          tarifa_por_fila: d.tarifa_por_fila,
          total_pago: d.total_pago,
          observaciones: parsed.obsLimpia,
          usuario_id: parsed.usuario_id,
          usuario_creador: parsed.usuario_creador,
          trabajadores: (d.trabajadores || []).map((dt: any) => ({
            id: dt.id,
            descarga_id: dt.descarga_id,
            trabajador_id: dt.trabajador_id,
            trabajador_nombre: dt.trabajador?.nombre || dt.trabajador?.alias || 'Trabajador',
            monto_individual: dt.monto_individual,
            pagado: dt.pagado,
            fecha_pago: dt.fecha_pago
          }))
        };
      });
      this.descargas.set(mapeadas);
    }

    // 3. Embarques con detalle de trabajadores
    const { data: embData } = await this.supabase
      .from('embarques_trailer')
      .select(`
        *,
        trabajadores:embarque_trabajadores (
          *,
          trabajador:trabajadores (nombre, alias)
        )
      `)
      .order('fecha', { ascending: false });

    if (embData) {
      const mapeadasEmb: EmbarqueTrailer[] = embData.map((e: any) => {
        const parsed = this.parseCreatorTag(e.observaciones);
        return {
          id: e.id,
          fecha: e.fecha,
          cantidad_trailers: e.cantidad_trailers,
          tarifa_por_persona_trailer: e.tarifa_por_persona_trailer,
          total_pago: e.total_pago,
          observaciones: parsed.obsLimpia,
          usuario_id: parsed.usuario_id,
          usuario_creador: parsed.usuario_creador,
          trabajadores: (e.trabajadores || []).map((et: any) => ({
            id: et.id,
            embarque_id: et.embarque_id,
            trabajador_id: et.trabajador_id,
            trabajador_nombre: et.trabajador?.nombre || et.trabajador?.alias || 'Trabajador',
            monto_individual: et.monto_individual,
            pagado: et.pagado,
            fecha_pago: et.fecha_pago
          }))
        };
      });
      this.embarques.set(mapeadasEmb);
    }
  }

  // ==========================================
  // CARGA DESDE LOCALSTORAGE (Modo Demo / Offline)
  // ==========================================
  private cargarDesdeLocalStorage() {
    // Auto-limpieza a cero: Resetea el historial previo para dejar cuentas en 0 limpio
    const LIMPIEZA_KEY = 'boya_cuentas_limpias_cero_v3';
    if (!localStorage.getItem(LIMPIEZA_KEY)) {
      localStorage.setItem(STORAGE_KEYS.DESCARGAS, JSON.stringify([]));
      localStorage.setItem(STORAGE_KEYS.EMBARQUES, JSON.stringify([]));
      localStorage.setItem(LIMPIEZA_KEY, 'true');
    }

    const rawTrab = localStorage.getItem(STORAGE_KEYS.TRABAJADORES);
    const rawDesc = localStorage.getItem(STORAGE_KEYS.DESCARGAS);
    const rawEmb = localStorage.getItem(STORAGE_KEYS.EMBARQUES);

    let listaTrab: Trabajador[] = [];
    if (rawTrab) {
      try {
        const parsed: any[] = JSON.parse(rawTrab);
        listaTrab = parsed.map(t => {
          const tagInfo = this.parseCreatorTag(t.telefono);
          return {
            ...t,
            telefono: tagInfo.obsLimpia,
            usuario_id: t.usuario_id || tagInfo.usuario_id,
            usuario_creador: t.usuario_creador || tagInfo.usuario_creador
          };
        });
      } catch (e) {
        listaTrab = [];
      }
    } else {
      listaTrab = this.generarTrabajadoresSemilla();
    }

    const semillas = this.generarTrabajadoresSemilla();
    for (const sem of semillas) {
      if (!listaTrab.some(t => t.id === sem.id || t.alias === sem.alias || t.nombre === sem.nombre)) {
        listaTrab.push(sem);
      }
    }

    this.trabajadores.set(listaTrab);
    localStorage.setItem(STORAGE_KEYS.TRABAJADORES, JSON.stringify(listaTrab));

    if (rawDesc) {
      try {
        const parsed: any[] = JSON.parse(rawDesc);
        const mapped = parsed.map(d => {
          const tagInfo = this.parseCreatorTag(d.observaciones);
          return {
            ...d,
            observaciones: tagInfo.obsLimpia,
            usuario_id: d.usuario_id || tagInfo.usuario_id,
            usuario_creador: d.usuario_creador || tagInfo.usuario_creador
          };
        });
        this.descargas.set(mapped);
      } catch (e) {
        this.descargas.set([]);
      }
    } else {
      this.descargas.set([]);
      localStorage.setItem(STORAGE_KEYS.DESCARGAS, JSON.stringify([]));
    }

    if (rawEmb) {
      try {
        const parsed: any[] = JSON.parse(rawEmb);
        const mapped = parsed.map(e => {
          const tagInfo = this.parseCreatorTag(e.observaciones);
          return {
            ...e,
            observaciones: tagInfo.obsLimpia,
            usuario_id: e.usuario_id || tagInfo.usuario_id,
            usuario_creador: e.usuario_creador || tagInfo.usuario_creador
          };
        });
        this.embarques.set(mapped);
      } catch (e) {
        this.embarques.set([]);
      }
    } else {
      this.embarques.set([]);
      localStorage.setItem(STORAGE_KEYS.EMBARQUES, JSON.stringify([]));
    }
  }

  public async reiniciarCuentasACero() {
    this.descargas.set([]);
    this.embarques.set([]);
    localStorage.setItem(STORAGE_KEYS.DESCARGAS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.EMBARQUES, JSON.stringify([]));
  }

  // ==========================================
  // MÉTODOS DE NEGOCIO: TRABAJADORES
  // ==========================================
  public async agregarTrabajador(nombre: string, alias?: string, telefono?: string): Promise<Trabajador> {
    const user = this.authService.usuarioActual();
    const userId = user?.id || 'usr_admin_jeremy';
    const userNom = user?.usuario || 'Jeremy';
    const tagInfo = this.buildCreatorTag(telefono, userId, userNom);

    const nuevo: Trabajador = {
      id: crypto.randomUUID ? crypto.randomUUID() : 'trab_' + Date.now(),
      nombre: nombre.trim(),
      alias: alias ? alias.trim() : nombre.trim(),
      telefono: tagInfo.obsLimpia,
      activo: true,
      usuario_id: userId,
      usuario_creador: userNom,
      created_at: new Date().toISOString()
    };

    if (this.isUsingSupabase() && this.supabase) {
      try {
        const insertPromise = this.supabase
          .from('trabajadores')
          .insert({
            nombre: nuevo.nombre,
            alias: nuevo.alias,
            telefono: tagInfo.obsConTag,
            activo: nuevo.activo
          })
          .select()
          .single();

        const res = await this.ejecutarConTimeout(insertPromise, 7500);
        if (res && !res.error && res.data) {
          nuevo.id = res.data.id;
        }
      } catch (e) {
        console.error('Error guardando trabajador en Supabase:', e);
      }
    }

    const actualizados = [...this.trabajadores(), nuevo];
    this.trabajadores.set(actualizados);
    localStorage.setItem(STORAGE_KEYS.TRABAJADORES, JSON.stringify(actualizados));
    return nuevo;
  }

  public async actualizarTrabajador(id: string, datos: { nombre: string; alias?: string; telefono?: string }): Promise<void> {
    const lista = this.trabajadores();
    const actual = lista.find(t => t.id === id);
    if (!actual) return;

    const user = this.authService.usuarioActual();
    const userId = actual.usuario_id || user?.id || 'usr_admin_jeremy';
    const userNom = actual.usuario_creador || user?.usuario || 'Jeremy';
    const tagInfo = this.buildCreatorTag(datos.telefono, userId, userNom);

    const trabajadorActualizado: Trabajador = {
      ...actual,
      nombre: datos.nombre.trim(),
      alias: (datos.alias && datos.alias.trim()) ? datos.alias.trim() : datos.nombre.trim(),
      telefono: tagInfo.obsLimpia,
      usuario_id: userId,
      usuario_creador: userNom
    };

    if (this.isUsingSupabase() && this.supabase) {
      try {
        const dbRes = await this.ejecutarConTimeout(
          this.supabase
            .from('trabajadores')
            .select('telefono')
            .eq('id', id)
            .single(),
          7500
        );

        const dbRow = dbRes?.data;
        const authMatch = (dbRow?.telefono || '').match(/<!--usr_auth:(.*?)-->/);
        const authTag = authMatch && !tagInfo.obsConTag.includes('<!--usr_auth:') ? ` ${authMatch[0]}` : '';

        await this.ejecutarConTimeout(
          this.supabase
            .from('trabajadores')
            .update({
              nombre: trabajadorActualizado.nombre,
              alias: trabajadorActualizado.alias,
              telefono: tagInfo.obsConTag + authTag
            })
            .eq('id', id),
          7500
        );
      } catch (e) {
        console.error('Error actualizando trabajador en Supabase:', e);
      }
    }

    const actualizados = lista.map(t => t.id === id ? trabajadorActualizado : t);
    this.trabajadores.set(actualizados);
    localStorage.setItem(STORAGE_KEYS.TRABAJADORES, JSON.stringify(actualizados));
  }

  public async eliminarTrabajador(id: string): Promise<void> {
    if (this.isUsingSupabase() && this.supabase) {
      try {
        await this.ejecutarConTimeout(
          this.supabase
            .from('trabajadores')
            .delete()
            .eq('id', id),
          7500
        );
      } catch (e) {
        console.error('Error eliminando trabajador en Supabase:', e);
      }
    }

    const actualizados = this.trabajadores().filter(t => t.id !== id);
    this.trabajadores.set(actualizados);
    localStorage.setItem(STORAGE_KEYS.TRABAJADORES, JSON.stringify(actualizados));
  }

  // ==========================================
  // MÉTODOS DE NEGOCIO: BAJADA DE MADERA
  // Fórmula: Total = Carros * Filas * TarifaFila ($5)
  // Monto por persona = Total / Cantidad Personas
  // ==========================================
  public async registrarDescarga(datos: {
    fecha: string;
    cantidad_carros: number;
    filas_por_carro: number;
    tarifa_por_fila?: number;
    trabajadores_ids: string[];
    observaciones?: string;
  }): Promise<DescargaMadera> {
    const tarifa = datos.tarifa_por_fila ?? 5.00;
    const totalPago = Number((datos.cantidad_carros * datos.filas_por_carro * tarifa).toFixed(2));
    const cantTrabajadores = Math.max(datos.trabajadores_ids.length, 1);
    const montoIndividual = Number((totalPago / cantTrabajadores).toFixed(2));

    const idDescarga = crypto.randomUUID ? crypto.randomUUID() : 'desc_' + Date.now();

    const listaTrabajadores: DescargaMadera['trabajadores'] = datos.trabajadores_ids.map(tid => {
      const t = this.trabajadores().find(w => w.id === tid);
      return {
        id: crypto.randomUUID ? crypto.randomUUID() : 'dt_' + Math.random(),
        descarga_id: idDescarga,
        trabajador_id: tid,
        trabajador_nombre: t ? (t.alias || t.nombre) : 'Trabajador',
        monto_individual: montoIndividual,
        pagado: false
      };
    });

    const user = this.authService.usuarioActual();
    const userId = user?.id || 'usr_admin_jeremy';
    const userNom = user?.usuario || 'Jeremy';
    const tagInfo = this.buildCreatorTag(datos.observaciones, userId, userNom);

    const nuevaDescarga: DescargaMadera = {
      id: idDescarga,
      fecha: datos.fecha,
      cantidad_carros: datos.cantidad_carros,
      filas_por_carro: datos.filas_por_carro,
      tarifa_por_fila: tarifa,
      total_pago: totalPago,
      observaciones: tagInfo.obsLimpia,
      usuario_id: userId,
      usuario_creador: userNom,
      trabajadores: listaTrabajadores,
      created_at: new Date().toISOString()
    };

    if (this.isUsingSupabase() && this.supabase) {
      try {
        const dRes = await this.ejecutarConTimeout(
          this.supabase
            .from('descargas_madera')
            .insert({
              fecha: nuevaDescarga.fecha,
              cantidad_carros: nuevaDescarga.cantidad_carros,
              filas_por_carro: nuevaDescarga.filas_por_carro,
              tarifa_por_fila: nuevaDescarga.tarifa_por_fila,
              total_pago: totalPago,
              observaciones: tagInfo.obsConTag
            })
            .select()
            .single(),
          7500
        );

        if (dRes && !dRes.error && dRes.data) {
          nuevaDescarga.id = dRes.data.id;
          const itemsInsert = listaTrabajadores.map(item => ({
            descarga_id: dRes.data.id,
            trabajador_id: item.trabajador_id,
            monto_individual: item.monto_individual,
            pagado: item.pagado
          }));
          await this.ejecutarConTimeout(this.supabase.from('descarga_trabajadores').insert(itemsInsert), 7500);
        }
      } catch (e) {
        console.error('Error guardando en Supabase:', e);
      }
    }

    const actualizadas = [nuevaDescarga, ...this.descargas()];
    this.descargas.set(actualizadas);
    localStorage.setItem(STORAGE_KEYS.DESCARGAS, JSON.stringify(actualizadas));
    return nuevaDescarga;
  }

  public async actualizarDescarga(id: string, datos: {
    fecha: string;
    cantidad_carros: number;
    filas_por_carro: number;
    tarifa_por_fila?: number;
    trabajadores_ids: string[];
    observaciones?: string;
  }): Promise<DescargaMadera | null> {
    const descargaActual = this.descargas().find(d => d.id === id);
    if (!descargaActual) return null;

    const tarifa = datos.tarifa_por_fila ?? descargaActual.tarifa_por_fila ?? 5.00;
    const totalPago = Number((datos.cantidad_carros * datos.filas_por_carro * tarifa).toFixed(2));
    const cantTrabajadores = Math.max(datos.trabajadores_ids.length, 1);
    const montoIndividual = Number((totalPago / cantTrabajadores).toFixed(2));

    const mapaPagados = new Map<string, { pagado: boolean; fecha_pago?: string }>();
    descargaActual.trabajadores.forEach(t => {
      mapaPagados.set(t.trabajador_id, { pagado: t.pagado, fecha_pago: t.fecha_pago });
    });

    const listaTrabajadores: DescargaMadera['trabajadores'] = datos.trabajadores_ids.map(tid => {
      const t = this.trabajadores().find(w => w.id === tid);
      const prev = mapaPagados.get(tid);
      return {
        id: crypto.randomUUID ? crypto.randomUUID() : 'dt_' + Math.random(),
        descarga_id: id,
        trabajador_id: tid,
        trabajador_nombre: t ? (t.alias || t.nombre) : 'Trabajador',
        monto_individual: montoIndividual,
        pagado: prev ? prev.pagado : false,
        fecha_pago: prev ? prev.fecha_pago : undefined
      };
    });

    const userId = descargaActual.usuario_id || this.authService.usuarioActual()?.id || 'usr_admin_jeremy';
    const userNom = descargaActual.usuario_creador || this.authService.usuarioActual()?.usuario || 'Jeremy';
    const tagInfo = this.buildCreatorTag(datos.observaciones, userId, userNom);

    const descargaModificada: DescargaMadera = {
      ...descargaActual,
      fecha: datos.fecha,
      cantidad_carros: datos.cantidad_carros,
      filas_por_carro: datos.filas_por_carro,
      tarifa_por_fila: tarifa,
      total_pago: totalPago,
      observaciones: tagInfo.obsLimpia,
      usuario_id: userId,
      usuario_creador: userNom,
      trabajadores: listaTrabajadores
    };

    if (this.isUsingSupabase() && this.supabase) {
      try {
        await this.ejecutarConTimeout(
          this.supabase
            .from('descargas_madera')
            .update({
              fecha: datos.fecha,
              cantidad_carros: datos.cantidad_carros,
              filas_por_carro: datos.filas_por_carro,
              tarifa_por_fila: tarifa,
              total_pago: totalPago,
              observaciones: tagInfo.obsConTag
            })
            .eq('id', id),
          7500
        );

        await this.ejecutarConTimeout(
          this.supabase.from('descarga_trabajadores').delete().eq('descarga_id', id),
          7500
        );
        const itemsInsert = listaTrabajadores.map(item => ({
          descarga_id: id,
          trabajador_id: item.trabajador_id,
          monto_individual: item.monto_individual,
          pagado: item.pagado,
          fecha_pago: item.fecha_pago
        }));
        await this.ejecutarConTimeout(
          this.supabase.from('descarga_trabajadores').insert(itemsInsert),
          7500
        );
      } catch (e) {
        console.error('Error actualizando descarga en Supabase:', e);
      }
    }

    const lista = this.descargas().map(d => d.id === id ? descargaModificada : d);
    this.descargas.set(lista);
    localStorage.setItem(STORAGE_KEYS.DESCARGAS, JSON.stringify(lista));
    return descargaModificada;
  }

  public async eliminarDescarga(id: string): Promise<boolean> {
    if (this.isUsingSupabase() && this.supabase) {
      try {
        await this.ejecutarConTimeout(
          this.supabase.from('descarga_trabajadores').delete().eq('descarga_id', id),
          7500
        );
        await this.ejecutarConTimeout(
          this.supabase.from('descargas_madera').delete().eq('id', id),
          7500
        );
      } catch (e) {
        console.error('Error eliminando descarga en Supabase:', e);
      }
    }

    const lista = this.descargas().filter(d => d.id !== id);
    this.descargas.set(lista);
    localStorage.setItem(STORAGE_KEYS.DESCARGAS, JSON.stringify(lista));
    return true;
  }

  // ==========================================
  // MÉTODOS DE NEGOCIO: EMBARQUE DE TRÁILERS
  // Fórmula: Monto por persona = Trailers * TarifaTrailer ($7)
  // Total = Trailers * TarifaTrailer ($7) * Cantidad Personas
  // ==========================================
  public async registrarEmbarque(datos: {
    fecha: string;
    cantidad_trailers: number;
    tarifa_por_persona_trailer?: number;
    trabajadores_ids: string[];
    observaciones?: string;
  }): Promise<EmbarqueTrailer> {
    const tarifa = datos.tarifa_por_persona_trailer ?? 7.00;
    const montoIndividual = Number((datos.cantidad_trailers * tarifa).toFixed(2));
    const cantTrabajadores = datos.trabajadores_ids.length;
    const totalPago = Number((montoIndividual * cantTrabajadores).toFixed(2));

    const idEmbarque = crypto.randomUUID ? crypto.randomUUID() : 'emb_' + Date.now();

    const listaTrabajadores: EmbarqueTrailer['trabajadores'] = datos.trabajadores_ids.map(tid => {
      const t = this.trabajadores().find(w => w.id === tid);
      return {
        id: crypto.randomUUID ? crypto.randomUUID() : 'et_' + Math.random(),
        embarque_id: idEmbarque,
        trabajador_id: tid,
        trabajador_nombre: t ? (t.alias || t.nombre) : 'Trabajador',
        monto_individual: montoIndividual,
        pagado: false
      };
    });

    const user = this.authService.usuarioActual();
    const userId = user?.id || 'usr_admin_jeremy';
    const userNom = user?.usuario || 'Jeremy';
    const tagInfo = this.buildCreatorTag(datos.observaciones, userId, userNom);

    const nuevoEmbarque: EmbarqueTrailer = {
      id: idEmbarque,
      fecha: datos.fecha,
      cantidad_trailers: datos.cantidad_trailers,
      tarifa_por_persona_trailer: tarifa,
      total_pago: totalPago,
      observaciones: tagInfo.obsLimpia,
      usuario_id: userId,
      usuario_creador: userNom,
      trabajadores: listaTrabajadores,
      created_at: new Date().toISOString()
    };

    if (this.isUsingSupabase() && this.supabase) {
      try {
        const eRes = await this.ejecutarConTimeout(
          this.supabase
            .from('embarques_trailer')
            .insert({
              fecha: nuevoEmbarque.fecha,
              cantidad_trailers: nuevoEmbarque.cantidad_trailers,
              tarifa_por_persona_trailer: nuevoEmbarque.tarifa_por_persona_trailer,
              total_pago: nuevoEmbarque.total_pago,
              observaciones: tagInfo.obsConTag
            })
            .select()
            .single(),
          7500
        );

        if (eRes && !eRes.error && eRes.data) {
          nuevoEmbarque.id = eRes.data.id;
          const itemsInsert = listaTrabajadores.map(item => ({
            embarque_id: eRes.data.id,
            trabajador_id: item.trabajador_id,
            monto_individual: item.monto_individual,
            pagado: item.pagado
          }));
          await this.ejecutarConTimeout(this.supabase.from('embarque_trabajadores').insert(itemsInsert), 7500);
        }
      } catch (e) {
        console.error('Error guardando en Supabase:', e);
      }
    }

    const actualizados = [nuevoEmbarque, ...this.embarques()];
    this.embarques.set(actualizados);
    localStorage.setItem(STORAGE_KEYS.EMBARQUES, JSON.stringify(actualizados));
    return nuevoEmbarque;
  }

  public async actualizarEmbarque(id: string, datos: {
    fecha: string;
    cantidad_trailers: number;
    tarifa_por_persona_trailer?: number;
    trabajadores_ids: string[];
    observaciones?: string;
  }): Promise<EmbarqueTrailer | null> {
    const embarqueActual = this.embarques().find(e => e.id === id);
    if (!embarqueActual) return null;

    const tarifa = datos.tarifa_por_persona_trailer ?? embarqueActual.tarifa_por_persona_trailer ?? 7.00;
    const montoIndividual = Number((datos.cantidad_trailers * tarifa).toFixed(2));
    const cantTrabajadores = datos.trabajadores_ids.length;
    const totalPago = Number((montoIndividual * cantTrabajadores).toFixed(2));

    const mapaPagados = new Map<string, { pagado: boolean; fecha_pago?: string }>();
    embarqueActual.trabajadores.forEach(t => {
      mapaPagados.set(t.trabajador_id, { pagado: t.pagado, fecha_pago: t.fecha_pago });
    });

    const listaTrabajadores: EmbarqueTrailer['trabajadores'] = datos.trabajadores_ids.map(tid => {
      const t = this.trabajadores().find(w => w.id === tid);
      const prev = mapaPagados.get(tid);
      return {
        id: crypto.randomUUID ? crypto.randomUUID() : 'et_' + Math.random(),
        embarque_id: id,
        trabajador_id: tid,
        trabajador_nombre: t ? (t.alias || t.nombre) : 'Trabajador',
        monto_individual: montoIndividual,
        pagado: prev ? prev.pagado : false,
        fecha_pago: prev ? prev.fecha_pago : undefined
      };
    });

    const userId = embarqueActual.usuario_id || this.authService.usuarioActual()?.id || 'usr_admin_jeremy';
    const userNom = embarqueActual.usuario_creador || this.authService.usuarioActual()?.usuario || 'Jeremy';
    const tagInfo = this.buildCreatorTag(datos.observaciones, userId, userNom);

    const embarqueModificado: EmbarqueTrailer = {
      ...embarqueActual,
      fecha: datos.fecha,
      cantidad_trailers: datos.cantidad_trailers,
      tarifa_por_persona_trailer: tarifa,
      total_pago: totalPago,
      observaciones: tagInfo.obsLimpia,
      usuario_id: userId,
      usuario_creador: userNom,
      trabajadores: listaTrabajadores
    };

    if (this.isUsingSupabase() && this.supabase) {
      try {
        await this.ejecutarConTimeout(
          this.supabase
            .from('embarques_trailer')
            .update({
              fecha: datos.fecha,
              cantidad_trailers: datos.cantidad_trailers,
              tarifa_por_persona_trailer: tarifa,
              total_pago: totalPago,
              observaciones: tagInfo.obsConTag
            })
            .eq('id', id),
          7500
        );

        await this.ejecutarConTimeout(
          this.supabase.from('embarque_trabajadores').delete().eq('embarque_id', id),
          7500
        );
        const itemsInsert = listaTrabajadores.map(item => ({
          embarque_id: id,
          trabajador_id: item.trabajador_id,
          monto_individual: item.monto_individual,
          pagado: item.pagado,
          fecha_pago: item.fecha_pago
        }));
        await this.ejecutarConTimeout(
          this.supabase.from('embarque_trabajadores').insert(itemsInsert),
          7500
        );
      } catch (e) {
        console.error('Error actualizando embarque en Supabase:', e);
      }
    }

    const lista = this.embarques().map(e => e.id === id ? embarqueModificado : e);
    this.embarques.set(lista);
    localStorage.setItem(STORAGE_KEYS.EMBARQUES, JSON.stringify(lista));
    return embarqueModificado;
  }

  public async eliminarEmbarque(id: string): Promise<boolean> {
    if (this.isUsingSupabase() && this.supabase) {
      try {
        await this.ejecutarConTimeout(
          this.supabase.from('embarque_trabajadores').delete().eq('embarque_id', id),
          7500
        );
        await this.ejecutarConTimeout(
          this.supabase.from('embarques_trailer').delete().eq('id', id),
          7500
        );
      } catch (e) {
        console.error('Error eliminando embarque en Supabase:', e);
      }
    }

    const lista = this.embarques().filter(e => e.id !== id);
    this.embarques.set(lista);
    localStorage.setItem(STORAGE_KEYS.EMBARQUES, JSON.stringify(lista));
    return true;
  }

  // ==========================================
  // CONTROL DE ESTADO DE PAGO INDIVIDUAL
  // Permite marcar "Pagado" o "Pendiente" a un trabajador
  // ==========================================
  public async cambiarEstadoPago(
    tipo: 'DESCARGA' | 'EMBARQUE',
    operacionId: string,
    trabajadorId: string,
    nuevoEstado: boolean
  ) {
    const fechaPago = nuevoEstado ? new Date().toISOString() : undefined;

    if (tipo === 'DESCARGA') {
      const lista = this.descargas().map(d => {
        if (d.id === operacionId) {
          return {
            ...d,
            trabajadores: d.trabajadores.map(t => {
              if (t.trabajador_id === trabajadorId) {
                return { ...t, pagado: nuevoEstado, fecha_pago: fechaPago };
              }
              return t;
            })
          };
        }
        return d;
      });
      this.descargas.set(lista);
      localStorage.setItem(STORAGE_KEYS.DESCARGAS, JSON.stringify(lista));

      if (this.isUsingSupabase() && this.supabase) {
        await this.ejecutarConTimeout(
          this.supabase
            .from('descarga_trabajadores')
            .update({ pagado: nuevoEstado, fecha_pago: fechaPago })
            .match({ descarga_id: operacionId, trabajador_id: trabajadorId }),
          7500
        );
      }
    } else {
      const lista = this.embarques().map(e => {
        if (e.id === operacionId) {
          return {
            ...e,
            trabajadores: e.trabajadores.map(t => {
              if (t.trabajador_id === trabajadorId) {
                return { ...t, pagado: nuevoEstado, fecha_pago: fechaPago };
              }
              return t;
            })
          };
        }
        return e;
      });
      this.embarques.set(lista);
      localStorage.setItem(STORAGE_KEYS.EMBARQUES, JSON.stringify(lista));

      if (this.isUsingSupabase() && this.supabase) {
        await this.ejecutarConTimeout(
          this.supabase
            .from('embarque_trabajadores')
            .update({ pagado: nuevoEstado, fecha_pago: fechaPago })
            .match({ embarque_id: operacionId, trabajador_id: trabajadorId }),
          7500
        );
      }
    }
  }

  // Marcar toda una operación como pagada
  public async marcarOperacionCompletaPagada(tipo: 'DESCARGA' | 'EMBARQUE', operacionId: string) {
    const fechaPago = new Date().toISOString();

    if (tipo === 'DESCARGA') {
      const lista = this.descargas().map(d => {
        if (d.id === operacionId) {
          return {
            ...d,
            trabajadores: d.trabajadores.map(t => ({ ...t, pagado: true, fecha_pago: fechaPago }))
          };
        }
        return d;
      });
      this.descargas.set(lista);
      localStorage.setItem(STORAGE_KEYS.DESCARGAS, JSON.stringify(lista));

      if (this.isUsingSupabase() && this.supabase) {
        await this.ejecutarConTimeout(
          this.supabase
            .from('descarga_trabajadores')
            .update({ pagado: true, fecha_pago: fechaPago })
            .eq('descarga_id', operacionId),
          7500
        );
      }
    } else {
      const lista = this.embarques().map(e => {
        if (e.id === operacionId) {
          return {
            ...e,
            trabajadores: e.trabajadores.map(t => ({ ...t, pagado: true, fecha_pago: fechaPago }))
          };
        }
        return e;
      });
      this.embarques.set(lista);
      localStorage.setItem(STORAGE_KEYS.EMBARQUES, JSON.stringify(lista));

      if (this.isUsingSupabase() && this.supabase) {
        await this.ejecutarConTimeout(
          this.supabase
            .from('embarque_trabajadores')
            .update({ pagado: true, fecha_pago: fechaPago })
            .eq('embarque_id', operacionId),
          7500
        );
      }
    }
  }

  // ==========================================
  // MOTOR DE REPORTES Y LIQUIDACIONES
  // ==========================================
  public obtenerReporteFiltrado(filtro: FiltroReporte): {
    movimientos: MovimientoLiquidacion[];
    resumen: ResumenReporte;
  } {
    const movimientos: MovimientoLiquidacion[] = [];
    let totalCarros = 0;
    let totalFilas = 0;
    let totalTrailers = 0;
    let totalGenerado = 0;
    let totalPagado = 0;
    let totalPendiente = 0;

    // 1. Filtrar descargas
    if (filtro.tipo_operacion === 'todos' || filtro.tipo_operacion === 'descargas' || !filtro.tipo_operacion) {
      for (const d of this.descargas()) {
        if (filtro.fecha_inicio && d.fecha < filtro.fecha_inicio) continue;
        if (filtro.fecha_fin && d.fecha > filtro.fecha_fin) continue;

        totalCarros += Number(d.cantidad_carros || 0);
        totalFilas += Number((d.cantidad_carros || 0) * (d.filas_por_carro || 0));

        for (const t of d.trabajadores || []) {
          if (filtro.trabajador_id && t.trabajador_id !== filtro.trabajador_id) continue;
          if (filtro.estado_pago === 'pagado' && !t.pagado) continue;
          if (filtro.estado_pago === 'pendiente' && t.pagado) continue;

          totalGenerado += Number(t.monto_individual);
          if (t.pagado) totalPagado += Number(t.monto_individual);
          else totalPendiente += Number(t.monto_individual);

          movimientos.push({
            id: 'mov_desc_' + d.id + '_' + t.trabajador_id,
            operacion_id: d.id,
            detalle_id: t.id,
            fecha: d.fecha,
            tipo: 'DESCARGA',
            descripcion: `${d.cantidad_carros} Carro(s) de ${d.filas_por_carro} filas`,
            trabajador_id: t.trabajador_id,
            trabajador_nombre: t.trabajador_nombre || 'Trabajador',
            monto: Number(t.monto_individual),
            pagado: t.pagado,
            fecha_pago: t.fecha_pago
          });
        }
      }
    }

    // 2. Filtrar embarques
    if (filtro.tipo_operacion === 'todos' || filtro.tipo_operacion === 'embarques' || !filtro.tipo_operacion) {
      for (const e of this.embarques()) {
        if (filtro.fecha_inicio && e.fecha < filtro.fecha_inicio) continue;
        if (filtro.fecha_fin && e.fecha > filtro.fecha_fin) continue;

        totalTrailers += Number(e.cantidad_trailers || 0);

        for (const t of e.trabajadores || []) {
          if (filtro.trabajador_id && t.trabajador_id !== filtro.trabajador_id) continue;
          if (filtro.estado_pago === 'pagado' && !t.pagado) continue;
          if (filtro.estado_pago === 'pendiente' && t.pagado) continue;

          totalGenerado += Number(t.monto_individual);
          if (t.pagado) totalPagado += Number(t.monto_individual);
          else totalPendiente += Number(t.monto_individual);

          movimientos.push({
            id: 'mov_emb_' + e.id + '_' + t.trabajador_id,
            operacion_id: e.id,
            detalle_id: t.id,
            fecha: e.fecha,
            tipo: 'EMBARQUE',
            descripcion: `${e.cantidad_trailers} Tráiler(s) de Boya`,
            trabajador_id: t.trabajador_id,
            trabajador_nombre: t.trabajador_nombre || 'Trabajador',
            monto: Number(t.monto_individual),
            pagado: t.pagado,
            fecha_pago: t.fecha_pago
          });
        }
      }
    }

    // Ordenar de más reciente a más antiguo
    movimientos.sort((a, b) => b.fecha.localeCompare(a.fecha));

    return {
      movimientos,
      resumen: {
        total_carros: totalCarros,
        total_filas: totalFilas,
        total_trailers: totalTrailers,
        total_generado: Number(totalGenerado.toFixed(2)),
        total_pagado: Number(totalPagado.toFixed(2)),
        total_pendiente: Number(totalPendiente.toFixed(2)),
        cantidad_faenas: movimientos.length
      }
    };
  }

  // ==========================================
  // EXPORTAR A EXCEL / CSV
  // ==========================================
  public exportarCSV(datos: any[], nombreArchivo = 'reporte-boya.csv') {
    if (!datos || datos.length === 0) return;

    let contenidoCSV = '';
    if ('tipo' in datos[0] && 'monto' in datos[0]) {
      const encabezados = ['Fecha', 'Tipo Operacion', 'Descripcion', 'Trabajador', 'Monto ($)', 'Estado Pago', 'Fecha Pago'];
      const lineas = (datos as MovimientoLiquidacion[]).map(m => [
        m.fecha,
        m.tipo,
        `"${m.descripcion}"`,
        `"${m.trabajador_nombre}"`,
        m.monto.toFixed(2),
        m.pagado ? 'PAGADO' : 'PENDIENTE',
        m.fecha_pago ? m.fecha_pago.split('T')[0] : ''
      ]);
      contenidoCSV = [encabezados.join(','), ...lineas.map(l => l.join(','))].join('\r\n');
    } else {
      const encabezados = Object.keys(datos[0]);
      const lineas = datos.map(row => encabezados.map(k => `"${row[k] ?? ''}"`).join(','));
      contenidoCSV = [encabezados.join(','), ...lineas].join('\r\n');
    }

    const blob = new Blob(['\ufeff' + contenidoCSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', nombreArchivo);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ==========================================
  // GENERADORES DE DATOS SEMILLA (Basados en las fotos del usuario)
  // ==========================================
  private generarTrabajadoresSemilla(): Trabajador[] {
    return [
      { id: 'trab_marco', nombre: 'Marco', alias: 'Marco', activo: true },
      { id: 'trab_coronel', nombre: 'Coronel', alias: 'Coronel', activo: true },
      { id: 'trab_jeremy', nombre: 'Jeremy', alias: 'Jeremy', activo: true },
      { id: 'trab_josue', nombre: 'Josué', alias: 'Josue', activo: true },
      { id: 'trab_erick', nombre: 'Erick', alias: 'Erick', activo: true },
      { id: 'trab_adonis', nombre: 'Adonis', alias: 'Adonis', activo: true },
      { id: 'trab_kelvin', nombre: 'Kelvin', alias: 'Kelvin', activo: true },
      { id: 'trab_edwin', nombre: 'Edwin', alias: 'Edwin', activo: true },
      { id: 'trab_johan', nombre: 'Johan', alias: 'Johan', activo: true }
    ];
  }

  private generarDescargasSemilla(trabajadores: Trabajador[]): DescargaMadera[] {
    // Cuentas en 0 por solicitud del usuario
    return [];
  }

  private generarEmbarquesSemilla(trabajadores: Trabajador[]): EmbarqueTrailer[] {
    // Cuentas en 0 por solicitud del usuario
    return [];
  }

  private async sembrarSupabase() {
    if (!this.supabase) return;
    try {
      const semillas = this.generarTrabajadoresSemilla();
      for (const s of semillas) {
        await this.supabase.from('trabajadores').upsert({
          nombre: s.nombre,
          alias: s.alias,
          activo: true
        });
      }
    } catch (e) {
      console.warn('No se pudo sembrar en Supabase:', e);
    }
  }
}
