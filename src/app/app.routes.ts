import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { DescargasComponent } from './features/descargas/descargas.component';
import { EmbarquesComponent } from './features/embarques/embarques.component';
import { HorasComponent } from './features/horas/horas.component';
import { ReportesComponent } from './features/reportes/reportes.component';
import { TrabajadoresComponent } from './features/trabajadores/trabajadores.component';
import { UsuariosComponent } from './features/usuarios/usuarios.component';
import { authGuard, adminGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, title: 'Iniciar Sesión - BoyaControl' },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard], title: 'Dashboard - BoyaControl' },
  { path: 'descargas', component: DescargasComponent, canActivate: [authGuard], title: 'Bajada de Madera - BoyaControl' },
  { path: 'embarques', component: EmbarquesComponent, canActivate: [authGuard], title: 'Embarque Tráilers - BoyaControl' },
  { path: 'horas', component: HorasComponent, canActivate: [authGuard], title: 'Horas Trabajadas - BoyaControl' },
  { path: 'reportes', component: ReportesComponent, canActivate: [authGuard], title: 'Reportes y Nómina - BoyaControl' },
  { path: 'trabajadores', component: TrabajadoresComponent, canActivate: [authGuard], title: 'Personal - BoyaControl' },
  { path: 'usuarios', component: UsuariosComponent, canActivate: [authGuard, adminGuard], title: 'Gestión de Usuarios - BoyaControl' },
  { path: '**', redirectTo: 'dashboard' }
];
