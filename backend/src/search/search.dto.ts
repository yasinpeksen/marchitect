import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsOptional,
  IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';

/** Query-string list parsing: "a, b,,c" -> ["a","b","c"]; arrays pass through; blank -> undefined. */
export const splitCommaSeparated = ({ value }: { value: unknown }): string[] | undefined => {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string' && value.length > 0) return value.split(',').map((item) => item.trim()).filter(Boolean);
  return undefined;
};

export class AdQueryDto {
  @IsOptional() @Transform(splitCommaSeparated) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true })
  keywords?: string[];
  @IsOptional() @IsIn(['any', 'all']) match?: 'any' | 'all';
  @IsOptional() @IsISO8601({ strict: true }) date_from?: string;
  @IsOptional() @IsISO8601({ strict: true }) date_to?: string;
  @IsOptional() @IsUUID() ad_account_id?: string;
  @IsOptional() @Transform(splitCommaSeparated) @IsArray() @IsUUID('4', { each: true }) campaign_ids?: string[];
  @IsOptional() @Transform(splitCommaSeparated) @IsArray() @IsIn(['image', 'video', 'carousel', 'dynamic', 'other'], { each: true }) formats?: string[];
  @IsOptional() @Transform(splitCommaSeparated) @IsArray() @IsString({ each: true }) platforms?: string[];
  @IsOptional() @Transform(splitCommaSeparated) @IsArray() @IsString({ each: true }) statuses?: string[];
  @IsOptional() @Type(() => Number) @IsNumber() min_spend?: number;
  @IsOptional() @Type(() => Number) @IsNumber() min_impressions?: number;
  @IsOptional() @Type(() => Number) @IsNumber() min_ctr?: number;
  @IsOptional() @Type(() => Number) @IsNumber() min_roas?: number;
  @IsOptional() @IsIn(['recent', 'spend', 'impressions', 'clicks', 'ctr', 'roas', 'revenue', 'purchases', 'name']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page_size?: number;
}

export class StartCollectionDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(80, { each: true })
  keywords: string[];
  @IsUUID() ad_account_id: string;
  @IsOptional() @IsISO8601({ strict: true }) date_from?: string;
  @IsOptional() @IsISO8601({ strict: true }) date_to?: string;
  @IsOptional() @IsUUID() saved_search_id?: string;
}

export class SavedSearchDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) tags: string[];
  @IsOptional() @IsIn(['any', 'all']) match_mode?: 'any' | 'all';
  @IsOptional() @IsObject() filters?: Record<string, unknown>;
  @IsOptional() @IsUUID() ad_account_id?: string;
}

export class UpdateSavedSearchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsIn(['any', 'all']) match_mode?: 'any' | 'all';
  @IsOptional() @IsObject() filters?: Record<string, unknown>;
  @IsOptional() @IsUUID() ad_account_id?: string;
}

export class SearchFlagDto {
  @IsOptional() @IsBoolean() collect?: boolean;
}

/** Normalise user-entered tags: trim, collapse whitespace, lowercase, dedupe, drop empties. */
export const normalizeKeywords = (keywords: string[] | undefined): string[] => [
  ...new Set((keywords ?? []).map((keyword) => keyword.replaceAll(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean)),
];
