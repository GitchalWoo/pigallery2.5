import {type TextSearch, TextSearchQueryMatchTypes} from '../../../../../../common/entities/SearchQueryDTO';

const matchTypes = {
  '~': TextSearchQueryMatchTypes.like,
  '=': TextSearchQueryMatchTypes.exact_match,
  glob: TextSearchQueryMatchTypes.globMatch,
};

export class TextSearchMatchingTypes {
  public static readonly values = ['~', '!~', '=', '!=', 'glob', '!glob'];

  public static get(query: TextSearch): string {
    const match = Object.keys(matchTypes).find(key => matchTypes[key as keyof typeof matchTypes] === query.matchType) ?? '~';
    return query.negate ? '!' + match : match;
  }

  public static set(query: TextSearch, value: string): void {
    const match = value.replace(/^!/, '') as keyof typeof matchTypes;
    query.negate = value.startsWith('!');
    query.matchType = matchTypes[match];
  }

  public static getDescription(type: string, isTextQuery: boolean): string {
    switch (type) {
      case '=':
        if (isTextQuery) {
          return $localize`Exact match (e.g.: bb matches for \' bb \')`;
        }
        return $localize`Exact match`;
      case '!=':
        return $localize`Exact negative match`;
      // only supported for text queries
      case '~':
        return $localize`Open and start match (e.g.: bb matches for \'abba\' and \' bb \')`;
      case '!~':
        return $localize`Negative open and start  match`;
      case 'glob':
        return $localize`glob match (supports wildcards: * and ?)`;
      case '!glob':
        return $localize`Negative glob match`;
    }
  }
}
