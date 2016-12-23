import { ModelFactoryBase } from 'spirit.io/lib/base';
import { IConnector, IModelFactory, IModelActions, IModelHelper, IModelController } from 'spirit.io/lib/interfaces';
import { Connection, Schema, Model, Query } from 'mongoose';
import { ModelActions } from './modelActions';
import { ModelHelper } from './modelHelper';
import { ModelController } from './modelController';
import { helper as objectHelper } from 'spirit.io/lib/utils';

import * as express from 'express';
import * as mongoose from 'mongoose';
import * as uniqueValidator from 'mongoose-unique-validator';
import * as idValidator from 'mongoose-id-validator';

let trace;// = console.log;

export interface IMongoModelFactory extends IModelFactory {
    createSchema(): any;
    model: Model<any>;
}


export class ModelFactory extends ModelFactoryBase implements IMongoModelFactory {

    public db: Connection;
    public schema: Schema;
    public model: Model<any>;

    constructor(name: string, targetClass: any, connector: IConnector) {
        super(name, targetClass, connector);
    }

    createSchema(): any {
        let schema = objectHelper.clone(this.$prototype, true);
        Object.keys(this.$references).forEach((k) => {
            let mf: IMongoModelFactory = <IMongoModelFactory>this.getModelFactoryByPath(k);
            if (mf.datasource === this.datasource) {
                if (schema[k].embedded) {
                    if (schema[k].ref === this.collectionName) {
                        throw new Error(`Cyclic embedded reference not allowed: property '${k}' with type '${schema[k].ref}' can't be set on model of type '${this.collectionName}'`);
                    }

                    schema[k] = mf.createSchema();
                    if (this.$plurals.indexOf(k) !== -1) {
                        schema[k] = [schema[k]];
                    }
                }
            } else {
                schema[k].type = "string";
                delete schema[k].ref;
            }
        });
        return new Schema(schema, { _id: false, versionKey: false } as any);
    }

    setup(routers: Map<string, express.Router>) {
        super.init(routers, new ModelActions(this), new ModelHelper(this), new ModelController(this));

        if (Object.keys(this.$prototype).length) {
            this.db = this.connector.getConnection(this.datasource || 'mongodb');
            let schema: Schema = this.createSchema();
            schema.plugin(uniqueValidator);
            schema.plugin(idValidator, { connection: this.db });

            this.model = this.db.model(this.collectionName, schema, this.collectionName);

        }


    }

    getModelFactoryByPath(path: string): IMongoModelFactory {
        return <IMongoModelFactory>super.getModelFactoryByPath(path);
    }
}