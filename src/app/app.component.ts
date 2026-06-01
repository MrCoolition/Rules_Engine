import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  nav = [
    { path: '/', label: 'Command' },
    { path: '/upload', label: 'Upload' },
    { path: '/execute', label: 'Execute' },
    { path: '/workbench', label: 'Workbench' },
    { path: '/reports', label: 'Reports' },
    { path: '/rules', label: 'Rules' },
    { path: '/settings', label: 'Settings' }
  ];
}
