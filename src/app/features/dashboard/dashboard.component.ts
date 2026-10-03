import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DataService } from '../../core/services/data.service';
import { AuthService } from '../../core/services/auth.service';

interface TopTrabajador {
  id: string;
  nombre: string;
  total_ganado: number;
  cantidad_faenas: number;
  porcentaje: number;
  estado: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  dataService = inject(DataService);
  authService = inject(AuthService);

  filtroPeriodo = signal<'auto' | 'hoy' | 'historico'>('auto');
  fechaHoy = 'Miércoles, 16 de septiembre de 2026';
  horaActual = '00:46:59';
  private timerId: any;

  ngOnInit() {
    this.actualizarHora();
    this.timerId = setInterval(() => this.actualizarHora(), 1000);
  }

  ngOnDestroy() {
    if (this.timerId) clearInterval(this.timerId);
  }

  private actualizarHora() {
    const ahora = new Date();
    const opciones: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    };
    const fechaStr = ahora.toLocaleDateString('es-ES', opciones);
    this.fechaHoy = fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1);
    this.horaActual = ahora.toTimeString().split(' ')[0];
  }

  // MÉTRICAS COMPUTADAS CON AISLAMIENTO ESTRICTO POR USUARIO
  misDescargasCount = computed(() => {
    return this.dataService.misDescargas().length;
  });

  misCarrosCount = computed(() => {
    return this.dataService.totalCarrosDescargados();
  });

  misEmbarquesCount = computed(() => {
    return this.dataService.misEmbarques().length;
  });

  misTrailersCount = computed(() => {
    return this.dataService.totalTrailersEmbarcados();
  });

  misDescargasCobrar = computed(() => {
    return this.dataService.misDescargas().reduce((sum, d) => {
      const trabs = d.trabajadores || [];
      const mi = trabs.find(t => this.authService.esMiTrabajador(t));
      const individual = mi ? mi.monto_individual : (trabs[0]?.monto_individual ?? (d.total_pago / (trabs.length || 1)));
      return sum + Number(individual || 0);
    }, 0);
  });

  totalDescargasPatioTotal = computed(() => {
    return this.dataService.misDescargas().reduce((sum, d) => sum + Number(d.total_pago || 0), 0);
  });

  misTrailersCobrar = computed(() => {
    return this.dataService.misEmbarques().reduce((sum, e) => {
      const trabs = e.trabajadores || [];
      const mi = trabs.find(t => this.authService.esMiTrabajador(t));
      const individual = mi ? mi.monto_individual : (trabs[0]?.monto_individual ?? (e.total_pago / (trabs.length || 1)));
      return sum + Number(individual || 0);
    }, 0);
  });

  totalTrailersPatioTotal = computed(() => {
    return this.dataService.misEmbarques().reduce((sum, e) => sum + Number(e.total_pago || 0), 0);
  });

  miPendienteCobro = computed(() => {
    return this.dataService.totalPendienteCobro();
  });

  miPagadoHistorico = computed(() => {
    return this.dataService.totalPagadoHistorico();
  });

  miTotalGanado = computed(() => {
    return this.miPagadoHistorico() + this.miPendienteCobro();
  });

  totalNominaRedondeada = computed(() => {
    return Math.round(this.miTotalGanado());
  });

  porcentajePagado = computed(() => {
    const total = this.miTotalGanado();
    if (total <= 0) return 100;
    return Math.round((this.miPagadoHistorico() / total) * 100);
  });

  porcentajePendiente = computed(() => {
    const total = this.miTotalGanado();
    if (total <= 0) return 0;
    return Math.round((this.miPendienteCobro() / total) * 100);
  });

  topTrabajadores = computed<TopTrabajador[]>(() => {
    const lista = this.dataService.misTrabajadores();
    const descargas = this.dataService.misDescargas();
    const embarques = this.dataService.misEmbarques();

    const mapa = new Map<string, { nombre: string; total: number; faenas: number }>();
    for (const t of lista) {
      mapa.set(t.id, { nombre: t.alias || t.nombre, total: 0, faenas: 0 });
    }

    if (!this.authService.esAdmin()) {
      for (const d of descargas) {
        for (const dt of d.trabajadores || []) {
          const item = mapa.get(dt.trabajador_id);
          if (item) {
            item.total += dt.monto_individual;
            item.faenas += 1;
          }
        }
      }
    }

    for (const e of embarques) {
      for (const et of e.trabajadores || []) {
        const item = mapa.get(et.trabajador_id);
        if (item) {
          item.total += et.monto_individual;
          item.faenas += 1;
        }
      }
    }

    const horas = this.dataService.misHorasTrabajadas();
    for (const h of horas) {
      const item = mapa.get(h.trabajador_id);
      if (item) {
        item.total += Number(h.total_pago || 0);
        item.faenas += 1;
      }
    }

    const items: TopTrabajador[] = [];
    mapa.forEach((val, key) => {
      if (val.faenas > 0) {
        items.push({
          id: key,
          nombre: val.nombre,
          total_ganado: val.total,
          cantidad_faenas: val.faenas,
          porcentaje: 0,
          estado: 'Activo'
        });
      }
    });

    items.sort((a, b) => b.total_ganado - a.total_ganado);
    const max = items[0]?.total_ganado || 1;
    items.forEach(i => {
      i.porcentaje = Math.min(100, Math.max(15, Math.round((i.total_ganado / max) * 100)));
    });

    return items.slice(0, 5);
  });

  ultimasOperaciones = computed(() => {
    const esAdmin = this.authService.esAdmin();

    const descargas = this.dataService.misDescargas()
      .filter(d => this.dataService.esMiRegistro(d))
      .map(d => {
        const trabs = d.trabajadores || [];
        const mi = trabs.find(t => this.authService.esMiTrabajador(t)) || (trabs.length > 0 ? trabs[0] : null);
        return {
          id: d.id,
          tipo: 'DESCARGA' as const,
          fecha: d.fecha,
          titulo: `${d.cantidad_carros} Carro(s) • ${d.filas_por_carro} filas`,
          subtitulo: trabs.map(t => t.trabajador_nombre).join(', '),
          monto: esAdmin ? d.total_pago : (mi ? mi.monto_individual : (d.total_pago / (trabs.length || 1))),
          totalCarro: d.total_pago,
          pagado: trabs.length > 0 ? (esAdmin ? trabs.every(t => t.pagado) : (mi ? mi.pagado : trabs.every(t => t.pagado))) : false
        };
      });

    const embarques = this.dataService.misEmbarques()
      .filter(e => this.dataService.esMiRegistro(e))
      .map(e => {
        const trabs = e.trabajadores || [];
        const mi = trabs.find(t => this.authService.esMiTrabajador(t)) || (trabs.length > 0 ? trabs[0] : null);
        return {
          id: e.id,
          tipo: 'EMBARQUE' as const,
          fecha: e.fecha,
          titulo: `${e.cantidad_trailers} Tráiler(s) de Boya`,
          subtitulo: `${trabs.length} cargadores`,
          monto: esAdmin ? e.total_pago : (mi ? mi.monto_individual : (trabs[0]?.monto_individual ?? (e.total_pago / (trabs.length || 1)))),
          totalCarro: e.total_pago,
          pagado: esAdmin ? trabs.every(t => t.pagado) : (mi ? mi.pagado : trabs.every(t => t.pagado))
        };
      });

    const horas = this.dataService.misHorasTrabajadas()
      .filter(h => this.dataService.esMiRegistro(h))
      .map(h => ({
        id: h.id,
        tipo: 'HORAS' as const,
        fecha: h.fecha,
        titulo: `${h.horas} hr(s) • ${h.actividad || 'Jornal'}`,
        subtitulo: h.trabajador_nombre,
        monto: h.total_pago,
        totalCarro: h.total_pago,
        pagado: h.pagado
      }));

    return [...descargas, ...embarques, ...horas]
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, 4);
  });

  exportarResumenCSV() {
    const descargas = this.dataService.misDescargas();

    const rows = descargas.map(d => ({
      Fecha: d.fecha,
      Carros: d.cantidad_carros,
      Filas: d.filas_por_carro,
      'A Cobrar': (d.trabajadores.find(t => this.authService.esMiTrabajador(t))?.monto_individual) ?? (d.total_pago / (d.trabajadores?.length || 1)),
      'Total Faena Carro': d.total_pago,
      Trabajadores: d.trabajadores.map(t => t.trabajador_nombre).join(' - ')
    }));
    this.dataService.exportarCSV(rows, 'resumen-operaciones-boya.csv');
  }
}
