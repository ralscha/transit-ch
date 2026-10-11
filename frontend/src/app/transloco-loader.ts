import { Service } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import de from '../../public/i18n/de.json';
import en from '../../public/i18n/en.json';
import fr from '../../public/i18n/fr.json';
import it from '../../public/i18n/it.json';

const translations: Record<string, Translation> = { de, en, fr, it };

@Service()
export class TranslocoAppLoader implements TranslocoLoader {
  getTranslation(lang: string) {
    return of(translations[lang] ?? en);
  }
}
