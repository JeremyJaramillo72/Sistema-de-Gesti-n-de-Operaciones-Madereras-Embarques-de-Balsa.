import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { FeedbackService } from '../../core/services/feedback.service';
import { DescargaMadera } from '../../core/models/boya.models';

@Component({
  selector: 'app-descargas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './descargas.component.html',
  styleUrl: './descargas.component.css'
})
export class DescargasComponent {
  dataService = inject(DataService);
  authService = inject(AuthService);
  feedbackService = inject(FeedbackService);
  Math = Math;

  guardando = signal<boolean>(false);
  mostrarFormulario = signal<boolean>(false);
  modoEdicion = signal<boolean>(false);
  idEnEdicion = signal<string | null>(null);

  // FILTROS REACTIVOS COMO SIGNALS
  fechaDesde = signal<string>('');
  fechaHasta = signal<string>('');
  filtroTexto = signal<string>('');

  // MODAL DE ELIMINACIÓN
  modalEliminarAbierto = signal<boolean>(false);
  itemAEliminar = signal<DescargaMadera | null>(null);

  // NOTIFICACIÓN TOAST
  mensajeExito = signal<string>('');

  // DATOS DEL FORMULARIO
  fecha = new Date().toISOString().split('T')[0];
  cantidadCarros = 1;
  filasPorCarro = 3;
  tarifaPorFila = 5.00;
  observaciones = '';
  seleccionadosIds = signal<string[]>([]);

  totalCalculado = computed(() => {
    return Number((this.cantidadCarros * this.filasPorCarro * this.tarifaPorFila).toFixed(2));
  });

  montoPorPersonaCalculado = computed(() => {
    const cant = Math.max(this.seleccionadosIds().length, 1);
    return Number((this.totalCalculado() / cant).toFixed(2));
  });

  // LISTADO REACTIVO: Se actualiza INMEDIATAMENTE ante cualquier cambio de fecha o texto
  descargasFiltradas = computed(() => {
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    const texto = this.filtroTexto().trim().toLowerCase();

    // Filtra exclusivamente las descargas registradas por el usuario en sesión
    return this.dataService.misDescargas().filter(d => {
      if (desde && d.fecha < desde) return false;
      if (hasta && d.fecha > hasta) return false;
      if (texto) {
        const matchObs = d.observaciones?.toLowerCase().includes(texto);
        const matchTrab = d.trabajadores.some(t => t.trabajador_nombre?.toLowerCase().includes(texto));
        if (!matchObs && !matchTrab) return false;
      }
      return true;
    });
  });

  totalFiltrado = computed(() => {
    return this.descargasFiltradas().reduce((acc, d) => acc + d.total_pago, 0);
  });

  totalACobrar = computed(() => {
    return this.descargasFiltradas().reduce((acc, d) => {
      const miDetalle = this.getMiDetalle(d);
      return acc + (miDetalle ? miDetalle.monto_individual : 0);
    }, 0);
  });

  miTotalPendiente = computed(() => {
    return this.descargasFiltradas().reduce((acc, d) => {
      const miDetalle = this.getMiDetalle(d);
      if (miDetalle && !miDetalle.pagado) {
        return acc + miDetalle.monto_individual;
      }
      return acc;
    }, 0);
  });

  miTotalCobrado = computed(() => {
    return this.descargasFiltradas().reduce((acc, d) => {
      const miDetalle = this.getMiDetalle(d);
      if (miDetalle && miDetalle.pagado) {
        return acc + miDetalle.monto_individual;
      }
      return acc;
    }, 0);
  });

  constructor() {
    this.seleccionarTrabajadorPorDefecto();
  }

  getMiDetalle(d: DescargaMadera) {
    const encontrado = d.trabajadores.find(t => this.authService.esMiTrabajador(t));
    if (encontrado) return encontrado;
    return d.trabajadores[0] || null;
  }

  getCompaneros(d: DescargaMadera) {
    const miDetalle = this.getMiDetalle(d);
    if (!miDetalle) return d.trabajadores;
    return d.trabajadores.filter(t => t.trabajador_id !== miDetalle.trabajador_id);
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

  async toggleMiPago(d: DescargaMadera) {
    if (this.guardando()) return;
    const miDetalle = this.getMiDetalle(d);
    if (!miDetalle) return;

    this.guardando.set(true);
    const nuevoEstado = !miDetalle.pagado;
    this.feedbackService.iniciarCarga(nuevoEstado ? 'Marcando faena como cobrada...' : 'Desmarcando estado de cobro...');
    try {
      await this.dataService.cambiarEstadoPago('DESCARGA', d.id, miDetalle.trabajador_id, nuevoEstado);
      this.feedbackService.finalizarExito(nuevoEstado ? '✓ Faena marcada como cobrada' : 'Estado de cobro desmarcado');
    } catch (e) {
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
    this.cantidadCarros = 1;
    this.filasPorCarro = 3;
    this.observaciones = '';
    this.seleccionarTrabajadorPorDefecto();
    this.mostrarFormulario.set(true);
  }

  puedeModificar(d: DescargaMadera): boolean {
    if (this.authService.esAdmin()) return true;
    return this.dataService.esMiRegistro(d);
  }

  iniciarEdicion(d: DescargaMadera) {
    if (!this.puedeModificar(d)) return;
    this.modoEdicion.set(true);
    this.idEnEdicion.set(d.id);
    this.fecha = d.fecha;
    this.cantidadCarros = d.cantidad_carros;
    this.filasPorCarro = d.filas_por_carro;
    this.tarifaPorFila = d.tarifa_por_fila;
    this.observaciones = d.observaciones || '';
    this.seleccionadosIds.set(d.trabajadores.map(t => t.trabajador_id));
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

  async guardarDescarga() {
    if (this.guardando()) return;
    if (this.seleccionadosIds().length === 0) return;

    this.guardando.set(true);
    const esEdicion = Boolean(this.modoEdicion() && this.idEnEdicion());
    this.feedbackService.iniciarCarga(
      esEdicion ? 'Actualizando bajada de madera...' : 'Guardando nueva bajada de madera...',
      'Sincronizando con la nube... por favor espera'
    );

    try {
      if (esEdicion) {
        await this.dataService.actualizarDescarga(this.idEnEdicion()!, {
          fecha: this.fecha,
          cantidad_carros: Number(this.cantidadCarros),
          filas_por_carro: Number(this.filasPorCarro),
          tarifa_por_fila: Number(this.tarifaPorFila),
          trabajadores_ids: this.seleccionadosIds(),
          observaciones: this.observaciones
        });
        this.feedbackService.finalizarExito('¡Bajada de madera actualizada con éxito!');
        this.cancelarEdicion();
      } else {
        await this.dataService.registrarDescarga({
          fecha: this.fecha,
          cantidad_carros: Number(this.cantidadCarros),
          filas_por_carro: Number(this.filasPorCarro),
          tarifa_por_fila: Number(this.tarifaPorFila),
          trabajadores_ids: this.seleccionadosIds(),
          observaciones: this.observaciones
        });
        this.feedbackService.finalizarExito('¡Nueva bajada guardada con éxito!');
        this.mostrarFormulario.set(false);
        this.observaciones = '';
      }
    } catch (err) {
      console.error('Error guardando descarga:', err);
      this.feedbackService.finalizarError('Hubo un retraso de conexión. Tus datos se resguardaron localmente.');
    } finally {
      this.guardando.set(false);
    }
  }

  abrirModalEliminar(d: DescargaMadera) {
    if (!this.puedeModificar(d)) return;
    this.itemAEliminar.set(d);
    this.modalEliminarAbierto.set(true);
  }

  cerrarModalEliminar() {
    this.modalEliminarAbierto.set(false);
    this.itemAEliminar.set(null);
  }

  async ejecutarEliminar() {
    if (this.guardando()) return;
    const d = this.itemAEliminar();
    if (!d) return;
    if (!this.puedeModificar(d)) return;

    this.guardando.set(true);
    this.feedbackService.iniciarCarga('Eliminando bajada de madera...', 'Actualizando registros...');
    try {
      await this.dataService.eliminarDescarga(d.id);
      this.cerrarModalEliminar();
      this.feedbackService.finalizarExito('Bajada de madera eliminada');
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
