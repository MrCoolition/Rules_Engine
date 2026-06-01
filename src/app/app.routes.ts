import type { Routes } from '@angular/router';
import { CommandCenterComponent } from './pages/command-center.component';
import { UploadIngestComponent } from './pages/upload-ingest.component';
import { ExecutionConsoleComponent } from './pages/execution-console.component';
import { WorkbenchComponent } from './pages/workbench.component';
import { ReportsComponent } from './pages/reports.component';
import { RuleCatalogComponent } from './pages/rule-catalog.component';
import { SettingsComponent } from './pages/settings.component';

export const routes: Routes = [
  { path: '', component: CommandCenterComponent, title: 'Compliance Rules' },
  { path: 'upload', component: UploadIngestComponent, title: 'Process PRF' },
  { path: 'execute', component: ExecutionConsoleComponent, title: 'Execution Console' },
  { path: 'workbench', component: WorkbenchComponent, title: 'Analyst Workbench' },
  { path: 'reports', component: ReportsComponent, title: 'Outcome Reporting' },
  { path: 'rules', component: RuleCatalogComponent, title: 'Rule Catalog' },
  { path: 'settings', component: SettingsComponent, title: 'Settings' },
  { path: '**', redirectTo: '' }
];
