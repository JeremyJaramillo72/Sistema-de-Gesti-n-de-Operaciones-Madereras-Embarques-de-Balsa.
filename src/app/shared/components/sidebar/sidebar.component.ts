import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DataService } from '../../../core/services/data.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css',
  host: {
    class: 'shrink-0 block'
  }
})
export class SidebarComponent {
  dataService = inject(DataService);
  authService = inject(AuthService);

  descargasCount = computed(() => {
    return this.dataService.misDescargas().length;
  });

  trailersCount = computed(() => {
    return this.dataService.misEmbarques().reduce((acc, e) => acc + Number(e.cantidad_trailers || 0), 0);
  });

  horasCount = computed(() => {
    return this.dataService.misHorasTrabajadas().length;
  });

  auditoriaCount = computed(() => {
    return this.dataService.misDescargas().length + this.dataService.misEmbarques().length + this.dataService.misHorasTrabajadas().length;
  });

  personalCount = computed(() => {
    return this.dataService.misTrabajadores().length;
  });
}

