import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';
import { FeedbackService } from '../../core/services/feedback.service';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface FaenaAuditoria {
  numero: string;
  trabajador: string;
  trabajadorId: string;
  fecha: string;
  tipo: 'DESCARGA' | 'EMBARQUE';
  detalle: string;
  observaciones?: string;
  monto: number;
  pagado: boolean;
  montoPagado: number;
  montoPendiente: number;
  estado: 'Por Liquidar' | 'Pagado' | 'Pago Chofer';
  operacionId: string;
}

export interface ResumenTrabajador {
  id: string;
  nombre: string;
  total_ganado: number;
  total_pagado: number;
  total_pendiente: number;
  cantidad_faenas: number;
}

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reportes.component.html',
  styleUrl: './reportes.component.css'
})
export class ReportesComponent {
  dataService = inject(DataService);
  authService = inject(AuthService);
  feedbackService = inject(FeedbackService);
  route = inject(ActivatedRoute);

  guardando = signal<boolean>(false);
  fechaHoy = new Date().toISOString().split('T')[0];

  // FILTROS REACTIVOS COMO SIGNALS
  terminoBusqueda = signal<string>('');
  trabajadorSeleccionado = signal<string>('');
  fechaDesde = signal<string>('');
  fechaHasta = signal<string>('');
  filtroPeriodo = signal<'hoy' | '7dias' | 'mes' | 'semana_abril' | 'todo'>('todo');
  filtroEstado = signal<'todos' | 'abiertos' | 'cerrados'>('todos');
  filtroTipoOperacion = signal<'TODOS' | 'DESCARGA' | 'EMBARQUE'>('TODOS');

  // Notificación flotante
  mensajeExito = signal<string>('');

  constructor() {
    // Si se navega desde el directorio de cuadrilla con ?empleado=Marco o ?tipo=DESCARGA
    this.route.queryParams.subscribe(params => {
      if (params['empleado']) {
        this.trabajadorSeleccionado.set(params['empleado']);
        // Limpiar filtros para mostrar inmediatamente todas las faenas de su nombre
        this.fechaDesde.set('');
        this.fechaHasta.set('');
        this.filtroPeriodo.set('todo');
        this.terminoBusqueda.set('');
        this.filtroEstado.set('todos');
      }
      if (params['tipo']) {
        const t = String(params['tipo']).toUpperCase();
        if (t === 'DESCARGA' || t === 'EMBARQUE' || t === 'TODOS') {
          this.filtroTipoOperacion.set(t as 'TODOS' | 'DESCARGA' | 'EMBARQUE');
        }
      }
    });
  }

  onFechaDesdeChange(val: string) {
    this.fechaDesde.set(val);
    if (val) this.filtroPeriodo.set('todo');
  }

  onFechaHastaChange(val: string) {
    this.fechaHasta.set(val);
    if (val) this.filtroPeriodo.set('todo');
  }

  cambiarPeriodo(periodo: 'hoy' | '7dias' | 'mes' | 'semana_abril' | 'todo') {
    this.filtroPeriodo.set(periodo);
    const hoy = new Date();
    const formato = (d: Date) => d.toISOString().split('T')[0];

    if (periodo === 'hoy') {
      this.fechaDesde.set(formato(hoy));
      this.fechaHasta.set(formato(hoy));
    } else if (periodo === '7dias') {
      const hace7 = new Date();
      hace7.setDate(hoy.getDate() - 7);
      this.fechaDesde.set(formato(hace7));
      this.fechaHasta.set(formato(hoy));
    } else if (periodo === 'semana_abril') {
      this.fechaDesde.set('2026-04-20');
      this.fechaHasta.set('2026-04-26');
    } else if (periodo === 'mes') {
      const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      this.fechaDesde.set(formato(inicioMes));
      this.fechaHasta.set(formato(hoy));
    } else {
      this.fechaDesde.set('');
      this.fechaHasta.set('');
    }
  }

  limpiarTodosFiltros() {
    this.terminoBusqueda.set('');
    this.trabajadorSeleccionado.set('');
    this.fechaDesde.set('');
    this.fechaHasta.set('');
    this.filtroPeriodo.set('todo');
    this.filtroEstado.set('todos');
    this.filtroTipoOperacion.set('TODOS');
    this.mostrarNotificacion('Filtros restablecidos');
  }

  // Mapeamos las faenas reales del patio (Descargas de Madera y Embarques de Tráilers)
  turnosFiltrados = computed<FaenaAuditoria[]>(() => {
    const descargas = this.dataService.misDescargas();
    const embarques = this.dataService.misEmbarques();
    const lista: FaenaAuditoria[] = [];

    const esAdmin = this.authService.esAdmin();

    // 1. Transformamos faenas de descarga de madera
    descargas.forEach((d, dIdx) => {
      const cantPers = Math.max(d.trabajadores.length, 1);
      d.trabajadores.forEach((t, tIdx) => {
        const numRegistro = '#' + (dIdx * 10 + tIdx + 1);
        lista.push({
          numero: numRegistro,
          trabajador: t.trabajador_nombre || 'Trabajador',
          trabajadorId: t.trabajador_id,
          fecha: d.fecha,
          tipo: 'DESCARGA',
          detalle: `${d.cantidad_carros} Carro(s) • ${d.filas_por_carro} filas ($${d.total_pago.toFixed(2)} total ÷ ${cantPers} pers.)`,
          observaciones: d.observaciones,
          monto: t.monto_individual,
          pagado: esAdmin ? true : t.pagado,
          montoPagado: esAdmin ? 0 : (t.pagado ? t.monto_individual : 0),
          montoPendiente: esAdmin ? 0 : (t.pagado ? 0 : t.monto_individual),
          estado: esAdmin ? 'Pago Chofer' : (t.pagado ? 'Pagado' : 'Por Liquidar'),
          operacionId: d.id
        });
      });
    });

    // 2. Transformamos faenas de embarque de tráilers
    embarques.forEach((e, eIdx) => {
      e.trabajadores.forEach((t, tIdx) => {
        const numRegistro = '#' + (100 + eIdx * 10 + tIdx);
        lista.push({
          numero: numRegistro,
          trabajador: t.trabajador_nombre || 'Trabajador',
          trabajadorId: t.trabajador_id,
          fecha: e.fecha,
          tipo: 'EMBARQUE',
          detalle: `${e.cantidad_trailers} Tráiler(s) de Bloques ($7.00/pers)`,
          observaciones: e.observaciones,
          monto: t.monto_individual,
          pagado: t.pagado,
          montoPagado: t.pagado ? t.monto_individual : 0,
          montoPendiente: t.pagado ? 0 : t.monto_individual,
          estado: t.pagado ? 'Pagado' : 'Por Liquidar',
          operacionId: e.id
        });
      });
    });

    const texto = this.terminoBusqueda().trim().toLowerCase();
    const emp = this.trabajadorSeleccionado();
    const estado = this.filtroEstado();
    const tipoOp = this.filtroTipoOperacion();
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();

    // Aplicar filtros reactivos
    const esUsuario = this.authService.esUsuario();

    return lista.filter(item => {
      // Si es rol USUARIO: SOLO mostrar faenas donde este usuario participó
      if (esUsuario) {
        if (!this.authService.esMiTrabajador({ trabajador_id: item.trabajadorId, trabajador_nombre: item.trabajador })) {
          return false;
        }
      }

      // Si es Admin y se busca a un empleado/trabajador en particular, mostrar exclusivamente sus tráilers
      if (esAdmin && emp && item.tipo === 'DESCARGA') {
        return false;
      }

      // Filtro por tipo de operación (DESCARGA vs EMBARQUE)
      if (tipoOp !== 'TODOS' && item.tipo !== tipoOp) return false;

      const fechaItem = item.fecha;

      // Filtro por rango de fechas (Desde - Hasta)
      if (desde && fechaItem < desde) return false;
      if (hasta && fechaItem > hasta) return false;

      // Búsqueda en vivo por texto (Trabajador, número de faena, detalle, notas)
      if (texto) {
        const matchTrabajador = item.trabajador.toLowerCase().includes(texto);
        const matchNumero = item.numero.toLowerCase().includes(texto);
        const matchDetalle = item.detalle.toLowerCase().includes(texto);
        const matchObs = item.observaciones ? item.observaciones.toLowerCase().includes(texto) : false;
        if (!matchTrabajador && !matchNumero && !matchDetalle && !matchObs) return false;
      }

      // Empleado dropdown / query param (búsqueda normalizada insensible a mayúsculas, tildes o coincidencia por ID)
      if (emp) {
        const normEmp = emp.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const normTrab = (item.trabajador || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const matchId = item.trabajadorId === emp;
        const matchNombre = normTrab === normEmp || normTrab.includes(normEmp) || normEmp.includes(normTrab);
        if (!matchId && !matchNombre) return false;
      }

      // Estado
      if (estado === 'abiertos' && item.pagado) return false;
      if (estado === 'cerrados' && !item.pagado) return false;

      return true;
    });
  });

  turnosPendientesCount = computed(() => {
    return this.turnosFiltrados().filter(t => !t.pagado).length;
  });

  totalRecaudacion = computed(() => {
    return this.turnosFiltrados().reduce((sum, t) => {
      if (this.authService.esAdmin() && t.tipo === 'DESCARGA') return sum;
      return sum + t.monto;
    }, 0);
  });

  totalDiferencia = computed(() => {
    return this.turnosFiltrados().reduce((sum, t) => {
      if (this.authService.esAdmin() && t.tipo === 'DESCARGA') return sum;
      return sum + t.montoPendiente;
    }, 0);
  });

  totalPagadoCalculado = computed(() => {
    return this.turnosFiltrados().reduce((sum, t) => {
      if (this.authService.esAdmin() && t.tipo === 'DESCARGA') return sum;
      return sum + t.montoPagado;
    }, 0);
  });

  resumenTrabajadores = computed<ResumenTrabajador[]>(() => {
    const mapa = new Map<string, ResumenTrabajador>();

    for (const t of this.turnosFiltrados()) {
      // Para el Admin, descargas de boya NO se suman a la cuenta de ninguna persona
      if (this.authService.esAdmin() && t.tipo === 'DESCARGA') {
        continue;
      }

      if (!mapa.has(t.trabajadorId)) {
        mapa.set(t.trabajadorId, {
          id: t.trabajadorId,
          nombre: t.trabajador,
          total_ganado: 0,
          total_pagado: 0,
          total_pendiente: 0,
          cantidad_faenas: 0
        });
      }

      const item = mapa.get(t.trabajadorId)!;
      item.total_ganado += t.monto;
      item.cantidad_faenas += 1;
      if (t.pagado) {
        item.total_pagado += t.monto;
      } else {
        item.total_pendiente += t.monto;
      }
    }

    return Array.from(mapa.values()).sort((a, b) => b.total_pendiente - a.total_pendiente);
  });

  async togglePago(t: FaenaAuditoria) {
    if (this.guardando()) return;
    this.guardando.set(true);
    const nuevoEstado = !t.pagado;
    this.feedbackService.iniciarCarga(nuevoEstado ? `Registrando pago de ${t.trabajador}...` : `Desmarcando pago de ${t.trabajador}...`);
    try {
      await this.dataService.cambiarEstadoPago(t.tipo, t.operacionId, t.trabajadorId, nuevoEstado);
      this.feedbackService.finalizarExito(nuevoEstado ? `Faena de ${t.trabajador} marcada como pagada` : `Pago de ${t.trabajador} desmarcado`);
    } catch (err) {
      this.feedbackService.finalizarError('Error al actualizar estado de pago');
    } finally {
      this.guardando.set(false);
    }
  }

  // Generar Reporte PDF Oficial y Descargar o Compartir
  async generarReporte() {
    await this.generarReportePDF();
  }

  async generarReportePDF() {
    if (this.guardando()) return;
    const faenas = this.turnosFiltrados();

    if (faenas.length === 0) {
      this.feedbackService.finalizarAdvertencia('No hay faenas en el filtro actual para generar el PDF');
      return;
    }

    this.guardando.set(true);
    this.feedbackService.iniciarCarga('Generando reporte PDF...', 'Preparando documento oficial...');

    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // 1. ENCABEZADO / MEMBRETE EJECUTIVO
      doc.setFillColor(15, 23, 42); // Navy Slate 900
      doc.rect(14, 12, 4, 14, 'F'); // Barra acento izquierda

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(15, 23, 42);
      doc.text('BOYACONTROL', 21, 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('SISTEMA OFICIAL DE AUDITORÍA Y LIQUIDACIÓN • PATIO 01', 21, 23);

      // Título del documento según filtro
      const tipoOp = this.filtroTipoOperacion();
      const tituloDoc = tipoOp === 'DESCARGA'
        ? 'AUDITORÍA DE BAJADA DE MADERA (CARROS)'
        : tipoOp === 'EMBARQUE'
          ? 'AUDITORÍA DE EMBARQUE DE TRÁILERS'
          : 'AUDITORÍA Y BALANCE OFICIAL DE CUADRILLA';

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(tituloDoc, 14, 33);

      // Metadatos a la derecha
      const emp = this.trabajadorSeleccionado();
      const periodoTexto = (this.fechaDesde() || this.fechaHasta())
        ? `${this.fechaDesde() || 'Inicio'} al ${this.fechaHasta() || 'Hoy'}`
        : (this.filtroPeriodo() === 'todo' ? 'HISTORIAL COMPLETO' : this.filtroPeriodo().toUpperCase());

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(`Fecha Emisión: ${this.fechaHoy}`, pageWidth - 14, 18, { align: 'right' });
      doc.text(`Período: ${periodoTexto}`, pageWidth - 14, 23, { align: 'right' });
      if (emp) {
        doc.text(`Trabajador: ${emp}`, pageWidth - 14, 28, { align: 'right' });
      }

      // Línea divisoria
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.4);
      doc.line(14, 36, pageWidth - 14, 36);

      // 2. CUATRO CAJAS DE MÉTRICAS FINANCIERAS
      const cardY = 40;
      const cardWidth = (pageWidth - 28 - 9) / 4; // 4 cajas con 3mm gap
      const cardHeight = 15;

      const metricas = [
        { label: 'JORNADAS / FAENAS', valor: `${faenas.length}`, highlight: false },
        { label: 'TOTAL GENERADO', valor: `$${this.totalRecaudacion().toFixed(2)}`, highlight: false },
        { label: 'YA PAGADO / COBRADO', valor: `$${this.totalPagadoCalculado().toFixed(2)}`, highlight: false },
        { label: 'SALDO POR LIQUIDAR', valor: `$${this.totalDiferencia().toFixed(2)}`, highlight: true }
      ];

      metricas.forEach((m, idx) => {
        const x = 14 + idx * (cardWidth + 3);
        if (m.highlight) {
          doc.setFillColor(241, 245, 249);
          doc.setDrawColor(15, 23, 42);
        } else {
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(226, 232, 240);
        }
        doc.roundedRect(x, cardY, cardWidth, cardHeight, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(100, 116, 139);
        doc.text(m.label, x + cardWidth / 2, cardY + 5, { align: 'center' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(m.highlight ? 15 : 30, m.highlight ? 23 : 41, m.highlight ? 42 : 59);
        doc.text(m.valor, x + cardWidth / 2, cardY + 11.5, { align: 'center' });
      });

      let currentY = cardY + cardHeight + 8;

      // 3. TABLA 1: BALANCE INDIVIDUAL POR TRABAJADOR
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text('1. BALANCE Y LIQUIDACIÓN POR TRABAJADOR', 14, currentY);
      currentY += 3;

      const filasResumen: any[] = this.resumenTrabajadores().map(r => [
        r.nombre,
        `${r.cantidad_faenas}`,
        `$${r.total_ganado.toFixed(2)}`,
        `$${r.total_pagado.toFixed(2)}`,
        `$${r.total_pendiente.toFixed(2)}`,
        '____________________'
      ]);

      // Fila de totales
      filasResumen.push([
        'TOTAL GENERAL',
        `${faenas.length}`,
        `$${this.totalRecaudacion().toFixed(2)}`,
        `$${this.totalPagadoCalculado().toFixed(2)}`,
        `$${this.totalDiferencia().toFixed(2)}`,
        ''
      ]);

      autoTable(doc, {
        startY: currentY,
        margin: { left: 14, right: 14 },
        head: [['TRABAJADOR', 'FAENAS', 'TOTAL GANADO', 'YA PAGADO', 'SALDO PENDIENTE', 'FIRMA CONFORME']],
        body: filasResumen,
        theme: 'grid',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7.5,
          halign: 'center'
        },
        bodyStyles: {
          fontSize: 7.5,
          textColor: [30, 41, 59]
        },
        columnStyles: {
          0: { halign: 'left', fontStyle: 'bold' },
          1: { halign: 'center' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right', fontStyle: 'bold' },
          5: { halign: 'center', textColor: [148, 163, 184] }
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        didParseCell: (data) => {
          if (data.row.index === filasResumen.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [241, 245, 249];
          }
        }
      });

      currentY = (doc as any).lastAutoTable.finalY + 8;

      // 4. TABLA 2: DETALLE CRONOLÓGICO DE FAENAS
      if (currentY + 28 > pageHeight) {
        doc.addPage();
        currentY = 16;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text('2. DETALLE CRONOLÓGICO DE MOVIMIENTOS Y JORNALES', 14, currentY);
      currentY += 3;

      const filasDetalle = faenas.map(f => [
        f.numero,
        f.fecha,
        f.trabajador,
        f.tipo === 'DESCARGA' ? 'Bajada Carros' : 'Embarque Tráiler',
        f.detalle,
        `$${f.monto.toFixed(2)}`,
        f.estado
      ]);

      autoTable(doc, {
        startY: currentY,
        margin: { left: 14, right: 14 },
        head: [['#', 'FECHA', 'TRABAJADOR', 'OPERACIÓN', 'DETALLE FAENA', 'MONTO', 'ESTADO']],
        body: filasDetalle,
        theme: 'striped',
        headStyles: {
          fillColor: [30, 41, 59],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7,
          halign: 'center'
        },
        bodyStyles: {
          fontSize: 7,
          textColor: [30, 41, 59]
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 14 },
          1: { halign: 'center', cellWidth: 20 },
          2: { halign: 'left', cellWidth: 32, fontStyle: 'bold' },
          3: { halign: 'center', cellWidth: 26 },
          4: { halign: 'left' },
          5: { halign: 'right', cellWidth: 20, fontStyle: 'bold' },
          6: { halign: 'center', cellWidth: 22 }
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        }
      });

      // 5. PIE DE PÁGINA EN TODAS LAS PÁGINAS
      const totalPaginas = doc.getNumberOfPages();
      for (let i = 1; i <= totalPaginas; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.setDrawColor(226, 232, 240);
        doc.line(14, pageHeight - 10, pageWidth - 14, pageHeight - 10);
        doc.text(`BoyaControl • Documento Oficial de Auditoría y Liquidación • Patio de Acopio`, 14, pageHeight - 6);
        doc.text(`Página ${i} de ${totalPaginas}`, pageWidth - 14, pageHeight - 6, { align: 'right' });
      }

      // 6. DESCARGA DIRECTA O COMPARTIR NATIVO EN MÓVIL
      const nombreArchivo = `reporte-boyacontrol-${this.fechaHoy}.pdf`;
      const pdfBlob = doc.output('blob');

      // Si el navegador soporta compartir archivos (iOS Safari, Android Chrome, etc.)
      if (typeof navigator !== 'undefined' && 'canShare' in navigator && (navigator as any).canShare) {
        try {
          const pdfFile = new File([pdfBlob], nombreArchivo, { type: 'application/pdf' });
          if ((navigator as any).canShare({ files: [pdfFile] })) {
            await navigator.share({
              title: 'Reporte Oficial BoyaControl',
              text: `Reporte de liquidación y faenas - ${this.fechaHoy}`,
              files: [pdfFile]
            });
            this.feedbackService.finalizarExito('¡Reporte PDF generado y compartido con éxito!');
            return;
          }
        } catch (shareErr: any) {
          if (shareErr.name === 'AbortError') {
            this.feedbackService.ocultar();
            return;
          }
        }
      }

      // Descarga directa a través de jsPDF
      doc.save(nombreArchivo);
      this.feedbackService.finalizarExito('¡Reporte PDF descargado con éxito!');
    } catch (e) {
      console.error('Error generando PDF:', e);
      this.feedbackService.finalizarError('Error generando el archivo PDF');
    } finally {
      this.guardando.set(false);
    }
  }

  exportarCSV() {
    const faenas = this.turnosFiltrados();
    if (faenas.length === 0) {
      this.feedbackService.finalizarAdvertencia('No hay faenas en el filtro actual para exportar');
      return;
    }

    const filas = faenas.map(t => ({
      '# Registro': t.numero,
      Trabajador: t.trabajador,
      Fecha: t.fecha,
      Operacion: t.tipo === 'DESCARGA' ? 'Bajada de Madera' : 'Embarque de Tráiler',
      Detalle: t.detalle,
      'Monto Jornal / A Cobrar ($)': t.monto,
      'Monto Pagado / Cobrado ($)': t.montoPagado,
      'Saldo Pendiente ($)': t.montoPendiente,
      Estado: t.estado,
      Observaciones: t.observaciones || ''
    }));

    const tipo = this.filtroTipoOperacion();
    const nombreArchivo = tipo === 'DESCARGA'
      ? 'auditoria-bajadas-carros-boya.csv'
      : tipo === 'EMBARQUE'
        ? 'auditoria-embarques-trailers-boya.csv'
        : 'auditoria-faenas-boya.csv';

    const etiqueta = tipo === 'DESCARGA'
      ? 'Bajadas de Carros'
      : tipo === 'EMBARQUE'
        ? 'Embarque de Tráilers'
        : 'General';

    this.dataService.exportarCSV(filas, nombreArchivo);
    this.feedbackService.finalizarExito(`Reporte CSV (${etiqueta}) exportado con éxito`);
  }

  imprimirReporte() {
    window.print();
  }

  private mostrarNotificacion(msg: string) {
    this.mensajeExito.set(msg);
    setTimeout(() => this.mensajeExito.set(''), 3000);
  }
}
