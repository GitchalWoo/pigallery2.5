import {Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn} from 'typeorm';
import {BaseSharingDTO} from '../../../../common/entities/SharingDTO';
import {UserEntity} from './UserEntity';
import {SearchQueryDTO} from '../../../../common/entities/SearchQueryDTO';

@Entity()
export class SharingEntity implements BaseSharingDTO {
  @PrimaryGeneratedColumn({unsigned: true})
  id: number;

  @Index({unique: true})
  @Column({unique: true})
  sharingKey: string;

  /*
  * This query determines what is available for the user through sharing
  * Basically it's an allow-list of photos.
  * */
  @Column({
    type: 'text',
    nullable: false,
    transformer: {
      from: (val: string) => {
        return val ? JSON.parse(val) : null;
      },
      to: (val: object) => {
        return val ? JSON.stringify(val) : null;
      },
    },
  })
  searchQuery: SearchQueryDTO;

  /**
   * Only of the defaults should be set at most. If none is set the defaultSearchView will be searchQuery
   */
  @Column({
    type: 'text',
    nullable: true
  })
  defaultDirectoryView: string;
  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      from: (val: string) => {
        return val ? JSON.parse(val) : null;
      },
      to: (val: object) => {
        return val ? JSON.stringify(val) : null;
      },
    },
  })
  defaultSearchView: SearchQueryDTO;

  @Column({type: 'text', nullable: true})
  password: string;

  @Column('bigint', {
    unsigned: true,
    transformer: {
      from: (v) => parseInt(v, 10),
      to: (v) => v,
    },
  })
  expires: number;

  @Column('bigint', {
    unsigned: true,
    transformer: {
      from: (v) => parseInt(v, 10),
      to: (v) => v,
    },
  })
  timeStamp: number;

  @ManyToOne(() => UserEntity, {onDelete: 'CASCADE', nullable: false})
  creator: UserEntity;
}
