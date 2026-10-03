-- ==============================================================================
-- PROYECTO BOYA - CONTROL DE DESCARGAS DE MADERA Y EMBARQUES DE TRÁILERS
-- Script SQL para Supabase (PostgreSQL)
-- Copia y pega este script en el SQL Editor de tu proyecto en Supabase
-- ==============================================================================

-- 1. Tabla de Trabajadores
CREATE TABLE IF NOT EXISTS public.trabajadores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    alias TEXT,
    telefono TEXT,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabla de Descargas de Madera (Carros / Camiones de boya en troza)
CREATE TABLE IF NOT EXISTS public.descargas_madera (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    cantidad_carros INTEGER NOT NULL DEFAULT 1 CHECK (cantidad_carros > 0),
    filas_por_carro INTEGER NOT NULL DEFAULT 3 CHECK (filas_por_carro > 0),
    tarifa_por_fila NUMERIC(10, 2) NOT NULL DEFAULT 5.00,
    total_pago NUMERIC(10, 2) NOT NULL,
    observaciones TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Detalle de Trabajadores por Descarga
CREATE TABLE IF NOT EXISTS public.descarga_trabajadores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    descarga_id UUID NOT NULL REFERENCES public.descargas_madera(id) ON DELETE CASCADE,
    trabajador_id UUID NOT NULL REFERENCES public.trabajadores(id) ON DELETE RESTRICT,
    monto_individual NUMERIC(10, 2) NOT NULL,
    pagado BOOLEAN DEFAULT FALSE,
    fecha_pago TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Tabla de Embarques de Tráilers (Bloques de Boya terminados)
CREATE TABLE IF NOT EXISTS public.embarques_trailer (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    cantidad_trailers INTEGER NOT NULL DEFAULT 1 CHECK (cantidad_trailers > 0),
    tarifa_por_persona_trailer NUMERIC(10, 2) NOT NULL DEFAULT 7.00,
    total_pago NUMERIC(10, 2) NOT NULL,
    observaciones TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Detalle de Trabajadores por Embarque (Quién cargó el tráiler)
CREATE TABLE IF NOT EXISTS public.embarque_trabajadores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    embarque_id UUID NOT NULL REFERENCES public.embarques_trailer(id) ON DELETE CASCADE,
    trabajador_id UUID NOT NULL REFERENCES public.trabajadores(id) ON DELETE RESTRICT,
    monto_individual NUMERIC(10, 2) NOT NULL,
    pagado BOOLEAN DEFAULT FALSE,
    fecha_pago TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Tabla de Usuarios del Sistema (Cuentas sincronizadas multidispositivo)
CREATE TABLE IF NOT EXISTS public.usuarios (
    id TEXT PRIMARY KEY,
    usuario TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    email TEXT,
    password TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'USUARIO',
    activo BOOLEAN DEFAULT TRUE,
    ultimo_acceso TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Tabla de Horas Trabajadas (Jornales y Horas Extras @ $2.50 base)
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

-- Índices para optimizar reportes por fecha y trabajador
CREATE INDEX IF NOT EXISTS idx_descargas_fecha ON public.descargas_madera(fecha);
CREATE INDEX IF NOT EXISTS idx_embarques_fecha ON public.embarques_trailer(fecha);
CREATE INDEX IF NOT EXISTS idx_descarga_trabajadores_trabajador ON public.descarga_trabajadores(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_embarque_trabajadores_trabajador ON public.embarque_trabajadores(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_horas_fecha ON public.horas_trabajadas(fecha);
CREATE INDEX IF NOT EXISTS idx_horas_trabajador ON public.horas_trabajadas(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_login ON public.usuarios(usuario);

-- ==============================================================================
-- Políticas de Seguridad RLS (Row Level Security)
-- Permitir lectura y escritura con la clave anónima de Supabase
-- ==============================================================================
ALTER TABLE public.trabajadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.descargas_madera ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.descarga_trabajadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embarques_trailer ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embarque_trabajadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horas_trabajadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todo en trabajadores" ON public.trabajadores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo en descargas_madera" ON public.descargas_madera FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo en descarga_trabajadores" ON public.descarga_trabajadores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo en embarques_trailer" ON public.embarques_trailer FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo en embarque_trabajadores" ON public.embarque_trabajadores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo en usuarios" ON public.usuarios FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo en horas_trabajadas" ON public.horas_trabajadas FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- DATOS INICIALES (Semilla extraída de tus libretas de control)
-- ==============================================================================
INSERT INTO public.trabajadores (nombre, alias) VALUES
    ('Marco', 'Marco'),
    ('Coronel', 'Coronel'),
    ('Jeremy', 'Jeremy'),
    ('Josué', 'Josue'),
    ('Erick', 'Erick'),
    ('Adonis', 'Adonis'),
    ('Kelvin', 'Kelvin'),
    ('Edwin', 'Edwin'),
    ('Johan', 'Johan')
ON CONFLICT DO NOTHING;

INSERT INTO public.usuarios (id, usuario, nombre, password, rol, activo) VALUES
    ('usr_admin_jeremy', 'Jeremy', 'Jeremy', '1939', 'ADMIN', true)
ON CONFLICT (usuario) DO NOTHING;
