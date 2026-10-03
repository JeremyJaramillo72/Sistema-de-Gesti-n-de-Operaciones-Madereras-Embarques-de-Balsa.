import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { FeedbackService } from '../../core/services/feedback.service';
import { RegistroHoraTrabajada } from '../../core/models/boya.models';

@Component({
  selector: 'app-horas',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './horas.component.html',
  styleUrl: './horas.component.css'
})
export class HorasComponent {
  dataService = inject(DataService);
  authService = inject(AuthService);
  feedbackService = inject(FeedbackService);
  Math = Math;

  guardando = signal<boolean>(false);
  mostrarFormulario = signal<boolean>(false);
  modoEdicion = signal<boolean>(false);
  idEnEdicion = signal<string | null>(null);

  // FILTROS REACTIVOS
  fechaDesde = signal<string>('');
  fechaHasta = signal<string>('');
  filtroTexto = signal<string>('');
  filtroEstado = signal<'todos' | 'pendientes' | 'pagados'>('todos');
  trabajadorFiltro = signal<string>('');
  filtroPeriodo = signal<'hoy' | '7dias' | 'mes' | 'todo'>('todo');

  // MODAL DE CONFIRMACIÓN DE ELIMINACIÓN
  modalEliminarAbierto = signal<boolean>(false);
  itemAEliminar = signal<RegistroHoraTrabajada | null>(null);

  // NOTIFICACIÓN FLOTANTE TOAST
  mensajeExito = signal<string>('');

  // CAMPOS DEL FORMULARIO
  fecha = new Date().toISOString().split('T')[0];
  horas: number = 8;
  tarifaPorHora: number = 2.50; // Tarifa por defecto solicitada: $2.50 / hora
  actividad: string = 'Jornal General';
  observaciones: string = '';
  seleccionadosIds = signal<string[]>([]);
  trabajadorIdEdicion: string = '';

  // LISTA DE ACTIVIDADES RÁPIDAS
  actividadesSugeridas: string[] = [
    'Jornal General',
    'Corte de Balsa',
    'Clasificación',
    'Limpieza de Patio',
    'Apilado de Madera',
    'Mantenimiento',
    'Carga y Despacho'
  ];

  // HORAS RÁPIDAS
  horasSugeridas: { label: string; horas: number }[] = [
    { label: '4h (Medio turno)', horas: 4 },
    { label: '6h (Jornada reducida)', horas: 6 },
    { label: '8h (Jornada completa)', horas: 8 },
    { label: '9h (+1h extra)', horas: 9 },
    { label: '10h (+2h extras)', horas: 10 },
    { label: '12h (Turno extendido)', horas: 12 }
  ];

  // CÁLCULOS REACTIVOS DEL FORMULARIO
  montoPorPersonaCalculado = computed(() => {
    const h = Number(this.horas) || 0;
    const t = Number(this.tarifaPorHora) || 0;
    return Number((h * t).toFixed(2));
  });

  totalCalculado = computed(() => {
    const cant = this.modoEdicion() ? 1 : this.seleccionadosIds().length;
    return Number((this.montoPorPersonaCalculado() * cant).toFixed(2));
  });

  // LISTADO REACTIVO FILTRADO
  horasFiltradas = computed<RegistroHoraTrabajada[]>(() => {
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    const texto = this.filtroTexto().trim().toLowerCase();
    const estado = this.filtroEstado();
    const trabId = this.trabajadorFiltro();

    return this.dataService.misHorasTrabajadas().filter(h => {
      if (desde && h.fecha < desde) return false;
      if (hasta && h.fecha > hasta) return false;
      if (estado === 'pendientes' && h.pagado) return false;
      if (estado === 'pagados' && !h.pagado) return false;
      if (trabId && h.trabajador_id !== trabId) return false;

      if (texto) {
        const nom = (h.trabajador_nombre || '').toLowerCase();
        const act = (h.actividad || '').toLowerCase();
        const obs = (h.observaciones || '').toLowerCase();
        if (!nom.includes(texto) && !act.includes(texto) && !obs.includes(texto)) {
          return false;
        }
      }
      return true;
    });
  });

  // KPIS REACTIVOS
  totalHorasFiltradas = computed(() => {
    return this.horasFiltradas().reduce((acc, h) => acc + Number(h.horas || 0), 0);
  });

  totalGeneradoFiltrado = computed(() => {
    return this.horasFiltradas().reduce((acc, h) => acc + Number(h.total_pago || 0), 0);
  });

  totalPendienteFiltrado = computed(() => {
    return this.horasFiltradas()
      .filter(h => !h.pagado)
      .reduce((acc, h) => acc + Number(h.total_pago || 0), 0);
  });

  totalPagadoFiltrado = computed(() => {
    return this.horasFiltradas()
      .filter(h => h.pagado)
      .reduce((acc, h) => acc + Number(h.total_pago || 0), 0);
  });

  constructor() {
    this.seleccionarTrabajadorPorDefecto();
  }

  obtenerDiaSemana(fechaStr: string): string {
    if (!fechaStr) return '';
    const partes = fechaStr.split('-');
    if (partes.length !== 3) return '';
    const y = parseInt(partes[0], 10);
    const m = parseInt(partes[1], 10) - 1;
    const d = parseInt(partes[2], 10);
    const fecha = new Date(y, m, d, 12, 0, 0);
    const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    return dias[fecha.getDay()] || '';
  }

  establecerHoras(cantidad: number) {
    this.horas = cantidad;
  }

  establecerActividad(nombre: string) {
    this.actividad = nombre;
  }

  restablecerTarifa() {
    this.tarifaPorHora = 2.50;
  }

  seleccionarTrabajadorPorDefecto() {
    const lista = this.dataService.trabajadoresParaFaena();
    const miTrab = lista.find(t => this.authService.esMiTrabajador(t));
    if (miTrab) {
      this.seleccionadosIds.set([miTrab.id]);
      this.trabajadorIdEdicion = miTrab.id;
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
        this.trabajadorIdEdicion = idGenerado;
      } else if (lista.length > 0) {
        this.seleccionadosIds.set([lista[0].id]);
        this.trabajadorIdEdicion = lista[0].id;
      }
    }
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

  abrirFormularioNuevo() {
    if (this.mostrarFormulario() && !this.modoEdicion()) {
      this.mostrarFormulario.set(false);
      return;
    }
    this.modoEdicion.set(false);
    this.idEnEdicion.set(null);
    this.fecha = new Date().toISOString().split('T')[0];
    this.horas = 8;
    this.tarifaPorHora = 2.50;
    this.actividad = 'Jornal General';
    this.observaciones = '';
    this.seleccionarTrabajadorPorDefecto();
    this.mostrarFormulario.set(true);
  }

  puedeModificar(h: RegistroHoraTrabajada): boolean {
    if (this.authService.esAdmin()) return true;
    return this.dataService.esMiRegistro(h);
  }

  iniciarEdicion(h: RegistroHoraTrabajada) {
    if (!this.puedeModificar(h)) return;
    this.modoEdicion.set(true);
    this.idEnEdicion.set(h.id);
    this.fecha = h.fecha;
    this.horas = h.horas;
    this.tarifaPorHora = h.tarifa_por_hora;
    this.actividad = h.actividad || 'Jornal General';
    this.observaciones = h.observaciones || '';
    this.trabajadorIdEdicion = h.trabajador_id;
    this.seleccionadosIds.set([h.trabajador_id]);
    this.mostrarFormulario.set(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cancelarEdicion() {
    this.modoEdicion.set(false);
    this.idEnEdicion.set(null);
    this.mostrarFormulario.set(false);
  }

  async guardarHoras() {
    if (this.guardando()) return;
    const esEdicion = Boolean(this.modoEdicion() && this.idEnEdicion());

    if (!esEdicion && this.seleccionadosIds().length === 0) {
      this.feedbackService.finalizarAdvertencia('Debes seleccionar al menos un trabajador');
      return;
    }

    if (esEdicion && !this.trabajadorIdEdicion) {
      this.feedbackService.finalizarAdvertencia('Debes seleccionar el trabajador');
      return;
    }

    const horasNum = Number(this.horas);
    if (!horasNum || horasNum <= 0) {
      this.feedbackService.finalizarAdvertencia('La cantidad de horas debe ser mayor a 0');
      return;
    }

    this.guardando.set(true);
    this.feedbackService.iniciarCarga(
      esEdicion ? 'Actualizando registro de horas...' : 'Guardando horas trabajadas...',
      'Guardando información del turno... por favor espera'
    );

    try {
      if (esEdicion) {
        await this.dataService.actualizarRegistroHora(this.idEnEdicion()!, {
          fecha: this.fecha,
          trabajador_id: this.trabajadorIdEdicion,
          horas: horasNum,
          tarifa_por_hora: Number(this.tarifaPorHora) || 2.50,
          actividad: this.actividad,
          observaciones: this.observaciones
        });
        this.feedbackService.finalizarExito('¡Registro de horas actualizado correctamente!');
        this.cancelarEdicion();
      } else {
        await this.dataService.registrarHoras({
          fecha: this.fecha,
          trabajadores_ids: this.seleccionadosIds(),
          horas: horasNum,
          tarifa_por_hora: Number(this.tarifaPorHora) || 2.50,
          actividad: this.actividad,
          observaciones: this.observaciones
        });
        const cant = this.seleccionadosIds().length;
        this.feedbackService.finalizarExito(
          cant === 1
            ? '¡Horas trabajadas registradas correctamente!'
            : `¡Se registraron horas para ${cant} trabajadores con éxito!`
        );
        this.mostrarFormulario.set(false);
      }
    } catch (err) {
      this.feedbackService.finalizarError('Error al guardar el registro de horas');
    } finally {
      this.guardando.set(false);
    }
  }

  async togglePago(h: RegistroHoraTrabajada) {
    if (this.guardando()) return;
    this.guardando.set(true);
    const nuevoEstado = !h.pagado;
    const esAdmin = this.authService.esAdmin();

    this.feedbackService.iniciarCarga(
      nuevoEstado ? 'Marcando como cobrado/pagado...' : 'Desmarcando pago...'
    );

    try {
      await this.dataService.cambiarEstadoPagoHora(h.id, nuevoEstado);
      this.feedbackService.finalizarExito(
        nuevoEstado
          ? (esAdmin ? `Turno de ${h.trabajador_nombre} marcado como pagado` : `Horas marcadas como cobradas`)
          : (esAdmin ? `Pago desmarcado para ${h.trabajador_nombre}` : `Cobro desmarcado`)
      );
    } catch (err) {
      this.feedbackService.finalizarError('Error al cambiar estado de pago');
    } finally {
      this.guardando.set(false);
    }
  }

  async marcarVisiblesPagadas() {
    if (this.guardando()) return;
    const pendientes = this.horasFiltradas().filter(h => !h.pagado);
    if (pendientes.length === 0) {
      this.feedbackService.finalizarAdvertencia('No hay registros de horas pendientes en el filtro actual');
      return;
    }

    const confirmar = confirm(`¿Marcar ${pendientes.length} turno(s) de horas como PAGADOS por un valor de $${this.totalPendienteFiltrado().toFixed(2)}?`);
    if (!confirmar) return;

    this.guardando.set(true);
    this.feedbackService.iniciarCarga('Liquidando turnos de horas...');

    try {
      const ids = pendientes.map(h => h.id);
      await this.dataService.marcarTodasHorasPagadas(ids);
      this.feedbackService.finalizarExito(`¡Se liquidaron ${pendientes.length} turno(s) de horas correctamente!`);
    } catch (err) {
      this.feedbackService.finalizarError('Error al liquidar horas');
    } finally {
      this.guardando.set(false);
    }
  }

  abrirModalEliminar(h: RegistroHoraTrabajada) {
    if (!this.puedeModificar(h)) return;
    this.itemAEliminar.set(h);
    this.modalEliminarAbierto.set(true);
  }

  cerrarModalEliminar() {
    this.modalEliminarAbierto.set(false);
    this.itemAEliminar.set(null);
  }

  async ejecutarEliminar() {
    const item = this.itemAEliminar();
    if (!item || this.guardando()) return;

    this.guardando.set(true);
    this.feedbackService.iniciarCarga('Eliminando registro de horas...');

    try {
      await this.dataService.eliminarRegistroHora(item.id);
      this.feedbackService.finalizarExito('Registro de horas eliminado');
      this.cerrarModalEliminar();
    } catch (err) {
      this.feedbackService.finalizarError('Error al eliminar registro');
    } finally {
      this.guardando.set(false);
    }
  }

  establecerPeriodo(tipo: 'hoy' | '7dias' | 'mes' | 'todo') {
    this.filtroPeriodo.set(tipo);
    const hoy = new Date();
    const formato = (d: Date) => d.toISOString().split('T')[0];

    if (tipo === 'hoy') {
      this.fechaDesde.set(formato(hoy));
      this.fechaHasta.set(formato(hoy));
    } else if (tipo === '7dias') {
      const hace7 = new Date();
      hace7.setDate(hoy.getDate() - 7);
      this.fechaDesde.set(formato(hace7));
      this.fechaHasta.set(formato(hoy));
    } else if (tipo === 'mes') {
      const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      this.fechaDesde.set(formato(inicioMes));
      this.fechaHasta.set(formato(hoy));
    } else {
      this.fechaDesde.set('');
      this.fechaHasta.set('');
      this.filtroTexto.set('');
      this.trabajadorFiltro.set('');
      this.filtroEstado.set('todos');
    }
  }

  limpiarFiltros() {
    this.fechaDesde.set('');
    this.fechaHasta.set('');
    this.filtroTexto.set('');
    this.trabajadorFiltro.set('');
    this.filtroEstado.set('todos');
    this.filtroPeriodo.set('todo');
  }

  exportarCSV() {
    const lista = this.horasFiltradas();
    if (lista.length === 0) {
      this.feedbackService.finalizarAdvertencia('No hay registros de horas para exportar');
      return;
    }

    const encabezados = ['Fecha', 'Dia', 'Trabajador', 'Horas', 'Tarifa/Hora ($)', 'Total Pago ($)', 'Actividad', 'Estado', 'Fecha Pago', 'Observaciones'];
    const lineas = lista.map(h => [
      h.fecha,
      this.obtenerDiaSemana(h.fecha),
      `"${h.trabajador_nombre}"`,
      h.horas,
      h.tarifa_por_hora.toFixed(2),
      h.total_pago.toFixed(2),
      `"${h.actividad || 'Jornal General'}"`,
      h.pagado ? 'PAGADO' : 'PENDIENTE',
      h.fecha_pago ? h.fecha_pago.split('T')[0] : '',
      `"${h.observaciones || ''}"`
    ]);

    const csvContent = [encabezados.join(','), ...lineas.map(l => l.join(','))].join('\r\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_horas_trabajadas_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.feedbackService.finalizarExito('Reporte de horas exportado exitosamente');
  }
}
