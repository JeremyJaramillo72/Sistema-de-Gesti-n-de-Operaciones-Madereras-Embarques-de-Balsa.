-- ==============================================================================
-- MIGRACIÓN SUPABASE: TABLA DE HORAS TRABAJADAS (Jornales y Horas Extras @ $2.50)
-- Ejecuta este script en el "SQL Editor" de tu proyecto en Supabase
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.horas_trabajadas (
    id TEXT PRIMARY KEY,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    trabajador_id TEXT NOT NULL,
    trabajador_nombre TEXT NOT NULL,
    horas NUMERIC(6, 2) NOT NULL DEFAULT 8.00,
    tarifa_por_hora NUMERIC(10, 2) NOT NULL DEFAULT 2.50,
    total_pago NUMERIC(10, 2) NOT NULL,
    actividad TEXT DEFAULT 'Jornal General',
    observaciones TEXT,
    pagado BOOLEAN DEFAULT FALSE,
    fecha_pago TIMESTAMPTZ,
    usuario_id TEXT,
    usuario_creador TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índices para búsquedas rápidas por fecha y por trabajador
CREATE INDEX IF NOT EXISTS idx_horas_fecha ON public.horas_trabajadas(fecha);
CREATE INDEX IF NOT EXISTS idx_horas_trabajador ON public.horas_trabajadas(trabajador_id);

-- Habilitar seguridad RLS y permitir lectura/escritura anónima
ALTER TABLE public.horas_trabajadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todo en horas_trabajadas" 
ON public.horas_trabajadas 
FOR ALL 
USING (true) 
WITH CHECK (true);
