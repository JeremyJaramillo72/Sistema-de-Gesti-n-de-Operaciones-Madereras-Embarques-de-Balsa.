import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { FeedbackService } from '../../core/services/feedback.service';
import { EmbarqueTrailer } from '../../core/models/boya.models';

@Component({
  selector: 'app-embarques',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './embarques.component.html',
  styleUrl: './embarques.component.css'
})
export class EmbarquesComponent {
  dataService = inject(DataService);
  authService = inject(AuthService);
  feedbackService = inject(FeedbackService);
  Math = Math;

  guardando = signal<boolean>(false);
  mostrarFormulario = signal<boolean>(false);
  modoEdicion = signal<boolean>(false);
  idEnEdicion = signal<string | null>(null);

  // FILTROS REACTIVOS CON SIGNALS
  fechaDesde = signal<string>('');
  fechaHasta = signal<string>('');
  filtroTexto = signal<string>('');

  // MODAL DE ELIMINACIÓN CON DISEÑO
  modalEliminarAbierto = signal<boolean>(false);
  itemAEliminar = signal<EmbarqueTrailer | null>(null);

  // NOTIFICACIÓN TOAST
  mensajeExito = signal<string>('');

  // Datos del formulario
  fecha = new Date().toISOString().split('T')[0];
  cantidadTrailers = 1;
  tarifaPorPersona = 7.00;
  observaciones = '';
  seleccionadosIds = signal<string[]>([]);

  montoPorPersonaCalculado = computed(() => {
    return Number((this.cantidadTrailers * this.tarifaPorPersona).toFixed(2));
  });

  totalCalculado = computed(() => {
    return Number((this.montoPorPersonaCalculado() * this.seleccionadosIds().length).toFixed(2));
  });

  // HISTORIAL FILTRADO REACTIVO: Se recalcula al instante al cambiar fechaDesde, fechaHasta o filtroTexto
  embarquesFiltrados = computed(() => {
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    const texto = this.filtroTexto().trim().toLowerCase();

    // Filtra exclusivamente los embarques registrados por el usuario en sesión
    return this.dataService.misEmbarques().filter(e => {
      if (desde && e.fecha < desde) return false;
      if (hasta && e.fecha > hasta) return false;
      if (texto) {
        const matchObs = e.observaciones?.toLowerCase().includes(texto);
        const matchTrab = e.trabajadores.some(t => t.trabajador_nombre?.toLowerCase().includes(texto));
        if (!matchObs && !matchTrab) return false;
      }
      return true;
    });
  });

  totalFiltrado = computed(() => {
    return this.embarquesFiltrados().reduce((acc, e) => acc + e.total_pago, 0);
  });

  totalPendienteCuadrilla = computed(() => {
    return this.embarquesFiltrados().reduce((acc, e) => {
      const pend = e.trabajadores.filter(t => !t.pagado).reduce((sum, t) => sum + t.monto_individual, 0);
      return acc + pend;
    }, 0);
  });

  totalPagadoCuadrilla = computed(() => {
    return this.embarquesFiltrados().reduce((acc, e) => {
      const pag = e.trabajadores.filter(t => t.pagado).reduce((sum, t) => sum + t.monto_individual, 0);
      return acc + pag;
    }, 0);
  });

  totalACobrar = computed(() => {
    return this.embarquesFiltrados().reduce((acc, e) => {
      const miDetalle = this.getMiDetalle(e);
      return acc + (miDetalle ? miDetalle.monto_individual : 0);
    }, 0);
  });

  miTotalPendiente = computed(() => {
    return this.embarquesFiltrados().reduce((acc, e) => {
      const miDetalle = this.getMiDetalle(e);
      if (miDetalle && !miDetalle.pagado) {
        return acc + miDetalle.monto_individual;
      }
      return acc;
    }, 0);
  });

  miTotalCobrado = computed(() => {
    return this.embarquesFiltrados().reduce((acc, e) => {
      const miDetalle = this.getMiDetalle(e);
      if (miDetalle && miDetalle.pagado) {
        return acc + miDetalle.monto_individual;
      }
      return acc;
    }, 0);
  });

  constructor() {
    this.seleccionarTrabajadorPorDefecto();
  }

  getMiDetalle(e: EmbarqueTrailer) {
    const encontrado = e.trabajadores.find(t => this.authService.esMiTrabajador(t));
    if (encontrado) return encontrado;
    return e.trabajadores[0] || null;
  }

  getCompaneros(e: EmbarqueTrailer) {
    const miDetalle = this.getMiDetalle(e);
    if (!miDetalle) return e.trabajadores;
    return e.trabajadores.filter(t => t.trabajador_id !== miDetalle.trabajador_id);
  }

  esMiTrabajador(t: { id?: string; nombre?: string; alias?: string; trabajador_id?: string; trabajador_nombre?: string }): boolean {
    return this.authService.esMiTrabajador(t);
  }

  seleccionarTrabajadorPorDefecto() {
    const lista = this.dataService.trabajadoresParaFaena();
    const miTrab = lista.find(t => this.authService.esMiTrabajador(t));
    if (miTrab) {
      this.seleccionadosIds.set([miTrab.id]);
    } else {
      const user = this.authService.usuarioActual();
      if (user) {
        const idGenerado = 'trab_' + user.usuario.toLowerCase().replace(/\s+/g, '_');
        const yaExiste = lista.some(t => t.id === idGenerado || t.alias?.toLowerCase() === user.usuario.toLowerCase());
        if (!yaExiste) {
          this.dataService.trabajadores.update(arr => [
            ...arr,
            { id: idGenerado, nombre: user.nombre || user.usuario, alias: user.usuario, activo: true }
          ]);
        }
        this.seleccionadosIds.set([idGenerado]);
      } else if (lista.length > 0) {
        this.seleccionadosIds.set([lista[0].id]);
      }
    }
  }

  async toggleMiPago(e: EmbarqueTrailer) {
    if (this.guardando()) return;
    const miDetalle = this.getMiDetalle(e);
    if (!miDetalle) return;

    this.guardando.set(true);
    const nuevoEstado = !miDetalle.pagado;
    this.feedbackService.iniciarCarga(nuevoEstado ? 'Marcando tráiler como cobrado...' : 'Desmarcando estado de cobro...');
    try {
      await this.dataService.cambiarEstadoPago('EMBARQUE', e.id, miDetalle.trabajador_id, nuevoEstado);
      this.feedbackService.finalizarExito(nuevoEstado ? '✓ Tráiler marcado como cobrado' : 'Estado de cobro desmarcado');
    } catch (err) {
      this.feedbackService.finalizarError('Error al actualizar estado');
    } finally {
      this.guardando.set(false);
    }
  }

  establecerPeriodo(tipo: 'hoy' | 'semana' | 'abril' | 'mes' | 'todo') {
    const hoy = new Date();
    const formato = (d: Date) => d.toISOString().split('T')[0];

    if (tipo === 'hoy') {
      this.fechaDesde.set(formato(hoy));
      this.fechaHasta.set(formato(hoy));
    } else if (tipo === 'semana') {
      const hace7 = new Date();
      hace7.setDate(hoy.getDate() - 7);
      this.fechaDesde.set(formato(hace7));
      this.fechaHasta.set(formato(hoy));
    } else if (tipo === 'abril') {
      this.fechaDesde.set('2026-04-20');
      this.fechaHasta.set('2026-04-26');
    } else if (tipo === 'mes') {
      const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      this.fechaDesde.set(formato(inicioMes));
      this.fechaHasta.set(formato(hoy));
    } else {
      this.fechaDesde.set('');
      this.fechaHasta.set('');
      this.filtroTexto.set('');
    }
  }

  limpiarFiltrosFecha() {
    this.fechaDesde.set('');
    this.fechaHasta.set('');
    this.filtroTexto.set('');
  }

  abrirFormularioNuevo() {
    if (this.mostrarFormulario() && !this.modoEdicion()) {
      this.mostrarFormulario.set(false);
      return;
    }
    this.modoEdicion.set(false);
    this.idEnEdicion.set(null);
    this.fecha = new Date().toISOString().split('T')[0];
    this.cantidadTrailers = 1;
    this.tarifaPorPersona = 7.00;
    this.observaciones = '';
    this.seleccionarTrabajadorPorDefecto();
    this.mostrarFormulario.set(true);
  }

  puedeModificar(e: EmbarqueTrailer): boolean {
    if (this.authService.esAdmin()) return true;
    return this.dataService.esMiRegistro(e);
  }

  iniciarEdicion(e: EmbarqueTrailer) {
    if (!this.puedeModificar(e)) return;
    this.modoEdicion.set(true);
    this.idEnEdicion.set(e.id);
    this.fecha = e.fecha;
    this.cantidadTrailers = e.cantidad_trailers;
    this.tarifaPorPersona = e.tarifa_por_persona_trailer;
    this.observaciones = e.observaciones || '';
    this.seleccionadosIds.set(e.trabajadores.map(t => t.trabajador_id));
    this.mostrarFormulario.set(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cancelarEdicion() {
    this.modoEdicion.set(false);
    this.idEnEdicion.set(null);
    this.mostrarFormulario.set(false);
  }

  toggleTrabajador(id: string) {
    const actuales = this.seleccionadosIds();
    if (actuales.includes(id)) {
      this.seleccionadosIds.set(actuales.filter(i => i !== id));
    } else {
      this.seleccionadosIds.set([...actuales, id]);
    }
  }

  estaSeleccionado(id: string): boolean {
    return this.seleccionadosIds().includes(id);
  }

  seleccionarTodosTrabajadores() {
    this.seleccionadosIds.set(this.dataService.trabajadoresParaFaena().map(t => t.id));
  }

  limpiarSeleccionTrabajadores() {
    this.seleccionadosIds.set([]);
  }

  async guardarEmbarque() {
    if (this.guardando()) return;
    if (this.seleccionadosIds().length === 0) return;

    this.guardando.set(true);
    const esEdicion = Boolean(this.modoEdicion() && this.idEnEdicion());
    this.feedbackService.iniciarCarga(
      esEdicion ? 'Actualizando embarque de tráiler...' : 'Guardando nuevo embarque de tráiler...',
      'Sincronizando con la nube... por favor espera'
    );

    try {
      if (esEdicion) {
        await this.dataService.actualizarEmbarque(this.idEnEdicion()!, {
          fecha: this.fecha,
          cantidad_trailers: Number(this.cantidadTrailers),
          tarifa_por_persona_trailer: Number(this.tarifaPorPersona),
          trabajadores_ids: this.seleccionadosIds(),
          observaciones: this.observaciones
        });
        this.feedbackService.finalizarExito('¡Embarque de tráiler actualizado con éxito!');
        this.cancelarEdicion();
      } else {
        await this.dataService.registrarEmbarque({
          fecha: this.fecha,
          cantidad_trailers: Number(this.cantidadTrailers),
          tarifa_por_persona_trailer: Number(this.tarifaPorPersona),
          trabajadores_ids: this.seleccionadosIds(),
          observaciones: this.observaciones
        });
        this.feedbackService.finalizarExito('¡Nuevo embarque de tráiler guardado!');
        this.mostrarFormulario.set(false);
        this.observaciones = '';
      }
    } catch (err) {
      console.error('Error guardando embarque:', err);
      this.feedbackService.finalizarError('Hubo un retraso de conexión. Tus datos se resguardaron localmente.');
    } finally {
      this.guardando.set(false);
    }
  }

  abrirModalEliminar(e: EmbarqueTrailer) {
    if (!this.puedeModificar(e)) return;
    this.itemAEliminar.set(e);
    this.modalEliminarAbierto.set(true);
  }

  cerrarModalEliminar() {
    this.modalEliminarAbierto.set(false);
    this.itemAEliminar.set(null);
  }

  async ejecutarEliminar() {
    if (this.guardando()) return;
    const e = this.itemAEliminar();
    if (!e) return;
    if (!this.puedeModificar(e)) return;

    this.guardando.set(true);
    this.feedbackService.iniciarCarga('Eliminando embarque de tráiler...', 'Actualizando registros...');
    try {
      await this.dataService.eliminarEmbarque(e.id);
      this.cerrarModalEliminar();
      this.feedbackService.finalizarExito('Embarque de tráiler eliminado');
    } catch (err) {
      console.error(err);
      this.feedbackService.finalizarError('Error al eliminar');
    } finally {
      this.guardando.set(false);
    }
  }

  private mostrarNotificacion(msg: string) {
    this.mensajeExito.set(msg);
    setTimeout(() => this.mensajeExito.set(''), 3000);
  }
}
