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
    { path: '/', label: 'Overview' },
    { path: '/upload', label: 'Process PRF' },
    { path: '/workbench', label: 'Review Rows' },
    { path: '/reports', label: 'Buckets' },
    { path: '/rules', label: 'Rules' },
    { path: '/settings', label: 'Settings' }
  ];
}
