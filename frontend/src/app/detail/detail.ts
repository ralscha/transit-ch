import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { StateService } from '../state.service';
import { Location } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { TransportModeIconComponent } from '../transport-api.service';

@Component({
  selector: 'app-detail',
  standalone: true,
  imports: [TranslocoPipe, TransportModeIconComponent],
  templateUrl: './detail.html',
  styleUrls: ['./detail.css'],
})
export class DetailComponent {
  state = inject(StateService);
  location = inject(Location);
  route = inject(ActivatedRoute);

  get entry() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return null;
    return this.state.stationboard().find((entry) => entry.id === id);
  }

  goBack() {
    this.location.back();
  }
}
