export interface Trabajador {
  id: string;
  nombre: string;
  alias: string;
  telefono?: string;
  activo: boolean;
  usuario_id?: string;
  usuario_creador?: string;
  created_at?: string;
}

export interface DescargaTrabajador {
  id?: string;
  descarga_id?: string;
  trabajador_id: string;
  trabajador_nombre?: string;
  monto_individual: number;
  pagado: boolean;
  fecha_pago?: string;
}

export interface DescargaMadera {
  id: string;
  fecha: string; // YYYY-MM-DD
  cantidad_carros: number;
  filas_por_carro: number;
  tarifa_por_fila: number; // Por defecto $5.00
  total_pago: number;
  observaciones?: string;
  usuario_id?: string;
  usuario_creador?: string;
  trabajadores: DescargaTrabajador[];
  created_at?: string;
}

export interface EmbarqueTrabajador {
  id?: string;
  embarque_id?: string;
  trabajador_id: string;
  trabajador_nombre?: string;
  monto_individual: number;
  pagado: boolean;
  fecha_pago?: string;
}

export interface EmbarqueTrailer {
  id: string;
  fecha: string; // YYYY-MM-DD
  cantidad_trailers: number;
  tarifa_por_persona_trailer: number; // Por defecto $7.00
  total_pago: number;
  observaciones?: string;
  usuario_id?: string;
  usuario_creador?: string;
  trabajadores: EmbarqueTrabajador[];
  created_at?: string;
}

export interface RegistroHoraTrabajada {
  id: string;
  fecha: string; // YYYY-MM-DD
  trabajador_id: string;
  trabajador_nombre: string;
  horas: number; // Ej: 8, 4, 6.5
  tarifa_por_hora: number; // Por defecto $2.50
  total_pago: number; // horas * tarifa_por_hora
  actividad?: string; // Ej: "Jornal General", "Corte de balsa", "Limpieza", etc.
  observaciones?: string;
  pagado: boolean;
  fecha_pago?: string;
  usuario_id?: string;
  usuario_creador?: string;
  created_at?: string;
}

export interface MovimientoLiquidacion {
  id: string;
  operacion_id: string;
  detalle_id?: string;
  fecha: string;
  tipo: 'DESCARGA' | 'EMBARQUE' | 'HORAS';
  descripcion: string;
  trabajador_id: string;
  trabajador_nombre: string;
  monto: number;
  pagado: boolean;
  fecha_pago?: string;
}

export interface FiltroReporte {
  fecha_inicio?: string;
  fecha_fin?: string;
  trabajador_id?: string;
  estado_pago?: 'todos' | 'pagado' | 'pendiente';
  tipo_operacion?: 'todos' | 'descargas' | 'embarques' | 'horas';
}

export interface ResumenReporte {
  total_carros: number;
  total_filas: number;
  total_trailers: number;
  total_generado: number;
  total_pagado: number;
  total_pendiente: number;
  cantidad_faenas: number;
}
