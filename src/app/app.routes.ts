import { Routes } from '@angular/router';
import { StationboardComponent } from './stationboard/stationboard';
import { SearchComponent } from './search/search';
import { DetailComponent } from './detail/detail';

export const routes: Routes = [
  { path: '', component: StationboardComponent },
  { path: 'search', component: SearchComponent },
  { path: 'detail/:id', component: DetailComponent },
  { path: '**', redirectTo: '' },
];
