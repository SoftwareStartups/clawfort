import * as pulumi from "@pulumi/pulumi";

export interface ConnectionArgs {
  host: pulumi.Output<string>;
  user: string;
  privateKey: pulumi.Output<string>;
  dialErrorLimit?: number;
  perDialTimeout?: number;
}
