import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { FeedbackService } from '../../core/services/feedback.service';

export interface FaenaTrabajadorItem {
  id: string;
  tipo: 'DESCARGA' | 'EMBARQUE';
  operacionId: string;
  fecha: string;
  titulo: string;
  detalle: string;
  observaciones?: string;
  monto: number;
  pagado: boolean;
  trabajadorId: string;
}

@Component({
  selector: 'app-trabajadores',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './trabajadores.component.html',
  styleUrl: './trabajadores.component.css'
})
export class TrabajadoresComponent {
  dataService = inject(DataService);
  authService = inject(AuthService);
  feedbackService = inject(FeedbackService);
  router = inject(Router);

  guardando = signal<boolean>(false);
  mostrarFormulario = signal<boolean>(false);
  modoEdicion = signal<boolean>(false);
  idEnEdicion = signal<string | null>(null);
  trabajadorAEliminar = signal<any | null>(null);
  nombre = '';
  alias = '';
  telefono = '';

  // MODAL DE AUDITORÍA DIRECTA DE UN TRABAJADOR
  trabajadorAuditoria = signal<any | null>(null);

  // MODAL DE CONFIRMACIÓN DE REINICIO A CERO ($0)
  modalLimpiarCuentasAbierto = signal<boolean>(false);

  // TOAST DE NOTIFICACIÓN
  mensajeExito = signal<string>('');

  // FILTRO DE VISTA PARA ADMIN: Cuadrilla Oficial de Patio vs Ayudantes de Usuarios
  filtroCategoria = signal<'patio' | 'ayudantes' | 'todos'>('patio');

  conteoPatio = computed(() => this.dataService.misTrabajadores().length);
  conteoAyudantes = computed(() => this.dataService.ayudantesDeOtrosUsuarios().length);
  conteoTodos = computed(() => this.dataService.todosLosTrabajadores().length);

  esMiTrabajador(t: { id?: string; nombre?: string; alias?: string; trabajador_id?: string; trabajador_nombre?: string }): boolean {
    return this.authService.esMiTrabajador(t);
  }

  coincideTrabajador(t: { id: string; nombre: string; alias?: string }, dt: { trabajador_id: string; trabajador_nombre?: string }): boolean {
    if (dt.trabajador_id && t.id) {
      if (dt.trabajador_id === t.id) return true;
      if (this.authService.esMiTrabajador(t) && this.authService.esMiTrabajador(dt)) return true;
      return false;
    }
    const tNom = t.nombre?.trim().toLowerCase();
    const tAlias = t.alias?.trim().toLowerCase();
    const dtNom = dt.trabajador_nombre?.trim().toLowerCase();
    if (dtNom && (dtNom === tNom || dtNom === tAlias)) return true;
    return false;
  }

  balancesTrabajadores = computed(() => {
    const esAdmin = this.authService.esAdmin();
    let lista = this.dataService.misTrabajadores();

    if (esAdmin) {
      if (this.filtroCategoria() === 'patio') {
        lista = this.dataService.misTrabajadores();
      } else if (this.filtroCategoria() === 'ayudantes') {
        lista = this.dataService.ayudantesDeOtrosUsuarios();
      } else {
        lista = this.dataService.todosLosTrabajadores();
      }
    }

    const descargas = this.dataService.misDescargas();
    const embarques = this.dataService.misEmbarques();

    return lista.map(t => {
      let totalGanado = 0;
      let totalPagado = 0;
      let totalPendiente = 0;
      let cantidadFaenas = 0;
      let cantidadDescargas = 0;
      let cantidadTrailers = 0;

      // 1. Descargas de madera (vehículos de boya):
      // Para el ADMIN: Jeremy NO paga las bajadas de carros de boya (las paga el chofer/vehículo externo directamente).
      // Por tanto, NO suman al saldo por liquidar ni a lo pagado por Jeremy.
      for (const d of descargas) {
        for (const dt of d.trabajadores || []) {
          if (this.coincideTrabajador(t, dt)) {
            cantidadDescargas++;
            if (!esAdmin) {
              totalGanado += dt.monto_individual;
              cantidadFaenas++;
              if (dt.pagado) totalPagado += dt.monto_individual;
              else totalPendiente += dt.monto_individual;
            }
          }
        }
      }

      // 2. Embarques de Tráilers (despachos de fábrica que Jeremy SÍ liquida y paga a la cuadrilla a $7/pers)
      for (const e of embarques) {
        for (const et of e.trabajadores || []) {
          if (this.coincideTrabajador(t, et)) {
            cantidadTrailers++;
            cantidadFaenas++;
            totalGanado += et.monto_individual;
            if (et.pagado) totalPagado += et.monto_individual;
            else totalPendiente += et.monto_individual;
          }
        }
      }

      const regUser = (t.usuario_creador || '').toLowerCase().trim();
      const regId = (t.usuario_id || '').toLowerCase().trim();
      const esPatio = (!regUser && !regId) || regUser === 'jeremy' || regId === 'usr_admin_jeremy';

      return {
        id: t.id,
        nombre: t.nombre,
        alias: t.alias || t.nombre,
        telefono: t.telefono,
        usuario_id: t.usuario_id,
        usuario_creador: t.usuario_creador,
        esPatio,
        total_ganado: totalGanado,
        total_pagado: totalPagado,
        total_pendiente: totalPendiente,
        cantidad_faenas: cantidadFaenas,
        cantidad_descargas: cantidadDescargas,
        cantidad_trailers: cantidadTrailers
      };
    }).sort((a, b) => b.total_pendiente - a.total_pendiente);
  });

  // Muestra TODAS las faenas asociadas al trabajador seleccionado en el modal
  faenasDelTrabajador = computed<FaenaTrabajadorItem[]>(() => {
    const t = this.trabajadorAuditoria();
    if (!t) return [];

    const descargas = this.dataService.misDescargas();
    const embarques = this.dataService.misEmbarques();
    const resultado: FaenaTrabajadorItem[] = [];

    // 1. Descargas (Bajadas de Madera) - Para Admin NO se incluyen porque el chofer paga directamente y a Jeremy solo le interesan los tráilers
    if (!this.authService.esAdmin()) {
      for (const d of descargas) {
        for (const dt of d.trabajadores || []) {
          if (this.coincideTrabajador(t, dt)) {
            resultado.push({
              id: 'desc_' + d.id + '_' + dt.trabajador_id,
              tipo: 'DESCARGA',
              operacionId: d.id,
              fecha: d.fecha,
              titulo: 'Bajada de Madera',
              detalle: `${d.cantidad_carros} Carro(s) • ${d.filas_por_carro} filas ($${d.total_pago.toFixed(2)} total ÷ ${Math.max(d.trabajadores.length, 1)} pers.)`,
              observaciones: d.observaciones,
              monto: dt.monto_individual,
              pagado: dt.pagado,
              trabajadorId: dt.trabajador_id
            });
          }
        }
      }
    }

    // 2. Embarques de Tráilers
    for (const e of embarques) {
      for (const et of e.trabajadores || []) {
        if (this.coincideTrabajador(t, et)) {
          resultado.push({
            id: 'emb_' + e.id + '_' + et.trabajador_id,
            tipo: 'EMBARQUE',
            operacionId: e.id,
            fecha: e.fecha,
            titulo: 'Embarque de Tráiler',
            detalle: `${e.cantidad_trailers} Tráiler(s) de Bloques`,
            observaciones: e.observaciones,
            monto: et.monto_individual,
            pagado: et.pagado,
            trabajadorId: et.trabajador_id
          });
        }
      }
    }

    // Ordenar de la más reciente a la más antigua
    return resultado.sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  puedeModificarTrabajador(item: any): boolean {
    if (!item) return false;
    // No se puede eliminar ni editar la propia cuenta desde esta tarjeta
    if (this.esMiTrabajador(item)) return false;
    // Admin puede editar/eliminar cuadrilla
    if (this.authService.esAdmin()) return true;
    // Usuario puede editar/eliminar a sus ayudantes agregados
    return true;
  }

  iniciarEdicion(item: any) {
    this.idEnEdicion.set(item.id);
    this.nombre = item.nombre || '';
    this.alias = item.alias || item.nombre || '';
    this.telefono = item.telefono || '';
    this.modoEdicion.set(true);
    this.mostrarFormulario.set(true);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  cancelarEdicion() {
    this.idEnEdicion.set(null);
    this.modoEdicion.set(false);
    this.nombre = '';
    this.alias = '';
    this.telefono = '';
    this.mostrarFormulario.set(false);
  }

  iniciarEliminacion(item: any) {
    this.trabajadorAEliminar.set(item);
  }

  cerrarModalEliminar() {
    this.trabajadorAEliminar.set(null);
  }

  async confirmarEliminacion() {
    if (this.guardando()) return;
    const t = this.trabajadorAEliminar();
    if (!t) return;

    this.guardando.set(true);
    this.feedbackService.iniciarCarga('Eliminando de nómina...', 'Actualizando personal...');
    try {
      await this.dataService.eliminarTrabajador(t.id);
      this.cerrarModalEliminar();
      if (this.idEnEdicion() === t.id) {
        this.cancelarEdicion();
      }
      this.feedbackService.finalizarExito(this.authService.esAdmin() ? 'Trabajador eliminado de nómina' : 'Ayudante eliminado de tu personal');
    } catch (err) {
      this.feedbackService.finalizarError('Error al eliminar');
    } finally {
      this.guardando.set(false);
    }
  }

  async guardarTrabajador() {
    if (this.guardando()) return;
    if (!this.nombre.trim()) return;

    this.guardando.set(true);
    const esEdicion = Boolean(this.modoEdicion() && this.idEnEdicion());
    const esAdmin = this.authService.esAdmin();

    this.feedbackService.iniciarCarga(
      esEdicion ? 'Actualizando datos...' : (esAdmin ? 'Registrando en nómina...' : 'Guardando ayudante...'),
      'Sincronizando con la nube... por favor espera'
    );

    try {
      if (esEdicion) {
        await this.dataService.actualizarTrabajador(this.idEnEdicion()!, {
          nombre: this.nombre,
          alias: this.alias,
          telefono: this.telefono
        });
        this.feedbackService.finalizarExito(esAdmin ? 'Trabajador actualizado en nómina' : 'Ayudante actualizado con éxito');
        this.cancelarEdicion();
      } else {
        await this.dataService.agregarTrabajador(this.nombre, this.alias, this.telefono);
        this.feedbackService.finalizarExito(esAdmin ? 'Nuevo trabajador registrado en nómina' : 'Nuevo ayudante agregado con éxito');
        this.cancelarEdicion();
      }
    } catch (err) {
      console.error(err);
      this.feedbackService.finalizarError('Hubo un retraso de conexión. Datos resguardados localmente.');
    } finally {
      this.guardando.set(false);
    }
  }

  abrirAuditoria(item: any) {
    this.trabajadorAuditoria.set(item);
  }

  cerrarAuditoria() {
    this.trabajadorAuditoria.set(null);
  }

  async togglePagoEnModal(f: FaenaTrabajadorItem) {
    if (this.guardando()) return;
    this.guardando.set(true);
    const nuevo = !f.pagado;
    this.feedbackService.iniciarCarga(nuevo ? 'Registrando pago...' : 'Desmarcando pago...');
    try {
      await this.dataService.cambiarEstadoPago(f.tipo, f.operacionId, f.trabajadorId, nuevo);
      this.feedbackService.finalizarExito(nuevo ? 'Turno marcado como pagado' : 'Pago desmarcado');
    } catch (err) {
      this.feedbackService.finalizarError('Error al actualizar pago');
    } finally {
      this.guardando.set(false);
    }
  }

  irAReporteCompleto(nombre: string) {
    this.cerrarAuditoria();
    this.router.navigate(['/reportes'], { queryParams: { empleado: nombre } });
  }

  abrirModalLimpiarCuentas() {
    this.modalLimpiarCuentasAbierto.set(true);
  }

  cerrarModalLimpiarCuentas() {
    this.modalLimpiarCuentasAbierto.set(false);
  }

  async confirmarLimpiarCuentas() {
    if (this.guardando()) return;
    this.guardando.set(true);
    this.feedbackService.iniciarCarga('Restableciendo cuentas...', 'Dejando saldos en $0.00 limpio...');
    try {
      await this.dataService.reiniciarCuentasACero();
      this.cerrarModalLimpiarCuentas();
      if (this.trabajadorAuditoria()) {
        this.cerrarAuditoria();
      }
      this.feedbackService.finalizarExito('¡Cuentas dejadas en $0.00 limpio! Todo al día.');
    } catch (err) {
      this.feedbackService.finalizarError('Error al reiniciar cuentas');
    } finally {
      this.guardando.set(false);
    }
  }

  private mostrarNotificacion(msg: string) {
    this.mensajeExito.set(msg);
    setTimeout(() => this.mensajeExito.set(''), 3500);
  }
}
