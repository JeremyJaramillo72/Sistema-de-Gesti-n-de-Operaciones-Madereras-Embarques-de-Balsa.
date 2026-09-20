import { Injectable, signal } from '@angular/core';

export type FeedbackType = 'loading' | 'success' | 'error' | 'warning';

@Injectable({
  providedIn: 'root'
})
export class FeedbackService {
  public visible = signal<boolean>(false);
  public cargando = signal<boolean>(false);
  public mensaje = signal<string>('');
  public subtitulo = signal<string>('');
  public tipo = signal<FeedbackType>('loading');

  private timer: any = null;

  /**
   * Muestra la pestañita flotante en modo de carga/espera activa.
   * Bloquea la pantalla para evitar dobles clics y duplicidad de registros por internet lento.
   */
  public iniciarCarga(mensaje: string, subtitulo: string = 'Sincronizando con la nube... por favor espera') {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.mensaje.set(mensaje);
    this.subtitulo.set(subtitulo);
    this.tipo.set('loading');
    this.cargando.set(true);
    this.visible.set(true);
  }

  /**
   * Finaliza la operación con éxito y muestra el check verde.
   * Se oculta automáticamente tras la duración especificada.
   */
  public finalizarExito(mensaje: string, subtitulo: string = 'Operación completada con éxito', duracionMs: number = 2800) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.mensaje.set(mensaje);
    this.subtitulo.set(subtitulo);
    this.tipo.set('success');
    this.cargando.set(false);
    this.visible.set(true);

    this.timer = setTimeout(() => {
      this.ocultar();
    }, duracionMs);
  }

  /**
   * Muestra advertencia o resultado con conexión lenta/offline.
   */
  public finalizarAdvertencia(mensaje: string, subtitulo: string = 'Guardado local seguro por baja señal', duracionMs: number = 3800) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.mensaje.set(mensaje);
    this.subtitulo.set(subtitulo);
    this.tipo.set('warning');
    this.cargando.set(false);
    this.visible.set(true);

    this.timer = setTimeout(() => {
      this.ocultar();
    }, duracionMs);
  }

  /**
   * Finaliza con error controlado sin dejar la pantalla bloqueada.
   */
  public finalizarError(mensaje: string, subtitulo: string = 'Intenta nuevamente o revisa tu señal', duracionMs: number = 3800) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.mensaje.set(mensaje);
    this.subtitulo.set(subtitulo);
    this.tipo.set('error');
    this.cargando.set(false);
    this.visible.set(true);

    this.timer = setTimeout(() => {
      this.ocultar();
    }, duracionMs);
  }

  /**
   * Cierra de inmediato la pestañita flotante y desbloquea la pantalla.
   */
  public ocultar() {
    this.visible.set(false);
    this.cargando.set(false);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
