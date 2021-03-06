import { IModelActions, IParameters } from 'spirit.io/lib/interfaces';
import { Model, Query } from 'mongoose';
import { IMongoModelFactory } from './modelFactory';
import { wait } from 'f-promise';
import { helper as objectHelper } from 'spirit.io/lib/utils';
import * as uuid from 'uuid';

function ensureId(item: any) {
    item._id = item._id || uuid.v4();
}

export class ModelActions implements IModelActions {

    constructor(private modelFactory: IMongoModelFactory) { }

    query(filter: Object = {}, options?: IParameters): any[] {
        options = options || {};
        let fields = Array.from(this.modelFactory.$fields.keys()).join(' ');
        let query: Query<any> = this.modelFactory.model.find(filter, fields);
        let skippedPopulates = [];
        if (options.includes) skippedPopulates = this.populateQuery(query, options.includes);
        let docs: any[] = wait(query.exec());
        return docs && docs.map((doc) => {
            let res = doc.toObject();
            skippedPopulates.forEach((k) => {
                this.modelFactory.populateField({ includes: options.includes }, res, k);
            });
            return res;
        }) || [];
    }

    read(filter: any, options?: IParameters): any {
        options = options || {};
        let query: Query<any> = !filter || typeof filter === 'string' ? this.modelFactory.model.findById(filter) : this.modelFactory.model.findOne(filter);
        let skippedPopulates = [];
        if (options.includes) skippedPopulates = this.populateQuery(query, options.includes);
        let doc = wait(query.exec());
        let res = doc && doc.toObject();

        if (!res) {
            return null;
        } else {
            if (options.ref) {
                let refModelFactory = this.modelFactory.getModelFactoryByPath(options.ref);
                let field = this.modelFactory.$fields.get(options.ref);
                if (field.isPlural) {
                    let filter = { _id: { $in: res[options.ref] } };
                    return refModelFactory.actions.query(filter, { includes: options.includes });
                } else {
                    return refModelFactory.actions.read(res[options.ref], { includes: options.includes });
                }
            } else {
                skippedPopulates.forEach((k) => {
                    this.modelFactory.populateField({ includes: options.includes }, res, k);
                });
                return res;
            }
        }
    }

    create(item: any, options?: IParameters): any {
        ensureId(item);
        item._createdAt = new Date();
        return this.update(item._id, item, options);
    }

    update(_id: any, item: any, options?: IParameters): any {
        if (item.hasOwnProperty('_id')) delete item._id; // TODO: clean data _created, _updated...
        item._updatedAt = new Date();
        let data: any = {};
        if (options.deleteMissing) {
            if (options.ref) {
                let key = options.ref;
                let field = this.modelFactory.$fields.get(key);
                if (field && item.hasOwnProperty(key)) {
                    // insert only properties MUST NOT be updated, but CAN be inserted at creation
                    if (!options.deleteReadOnly || (options.deleteReadOnly && !field.isInsertOnly)) {
                        data.$set = data.$set || {};
                        // TODO: body should not contains key... Maybe I got something with processReverse that I can't remember ?
                        data.$set[key] = item[key];
                    }
                }
            } else {
                for (let [key, field] of this.modelFactory.$fields) {
                    // read only properties MUST NOT be updated, but CAN be inserted at creation
                    if (!options.deleteReadOnly || (options.deleteReadOnly && !field.isInsertOnly)) {
                        if (!item.hasOwnProperty(key)) {
                            if (!field.isInsertOnly) {
                                data.$unset = data.$unset || {};
                                data.$unset[key] = 1;
                            }
                        } else {
                            data.$set = data.$set || {};
                            data.$set[key] = item[key];
                        }
                    }
                }
            }
        } else {
            // TODO : manage options.ref for PATCH operation.
            for (let [key, field] of this.modelFactory.$fields) {
                if (item.hasOwnProperty(key) && item[key] !== undefined) {
                    // read only properties MUST NOT be updated, but CAN be inserted at creation
                    if (!options.deleteReadOnly || (options.deleteReadOnly && !field.isInsertOnly)) {
                        if (field.isPlural) {
                            data.$addToSet = data.$addToSet || {};
                            data.$addToSet[key] = { $each: (Array.isArray(item[key]) ? item[key] : [item[key]]) };
                        } else {
                            data.$set = data.$set || {};
                            data.$set[key] = item[key];
                        }
                    }
                }
            }
        }
        //console.log("DATA:", data)
        /* context is not declare in .d.ts file but it is mandatory to have unique validator working !!! */
        let query: any = this.modelFactory.model.findOneAndUpdate({ _id: _id }, data, { runValidators: true, new: true, upsert: true, context: 'query' } as any);

        let skippedPopulates = [];
        if (options.includes) skippedPopulates = this.populateQuery(query, options.includes);

        let doc: any;
        try {
            doc = wait(query.exec());
        } catch (e) {
            if (e.errors) {
                let diags = [];
                objectHelper.forEachKey(e.errors, (key, value) => {
                    diags.push({
                        $severity: 'error',
                        $message: value.name + ': ' + value.message,
                        $stack: value.stack
                    });
                });
                if (diags.length) e.$diagnoses = diags;
            }
            throw e;
        }
        let res = doc && doc.toObject();
        skippedPopulates.forEach((k) => {
            this.modelFactory.populateField({ includes: options.includes }, res, k);
        });
        this.processReverse(doc._id, res, options.ref);
        return res;
    }

    delete(_id: any) {
        return wait(<any>this.modelFactory.model.remove({ _id: _id }));
    }

    private processReverse(_id: string, item: any, subProperty?: string): void {
        for (let path in this.modelFactory.$references) {
            let refOpt = this.modelFactory.$references[path] || {};
            let revKey = refOpt.$reverse;
            if (revKey && item.hasOwnProperty(path)) {
                let revModelFactory: IMongoModelFactory = subProperty ? <IMongoModelFactory>this.modelFactory.getModelFactoryByPath(subProperty) : this.modelFactory;
                let field = revModelFactory.$fields.get(path);
                // Do not update insert only property
                if (field.isInsertOnly) return;

                let refItem = {};
                refItem[revKey] = field.isPlural ? [_id] : _id;

                let update;
                if (field.isPlural) {
                    update = { $addToSet: {} };
                    update.$addToSet[revKey] = { $each: [_id] };
                } else {
                    update = { $set: {} };
                    update.$set[revKey] = _id;
                }

                let refIds: Array<string> = Array.isArray(item[path]) ? item[path] : [item[path]];
                //console.log("Update: "+JSON.stringify({ _id: { $in: refIds}})+":"+JSON.stringify(update));

                // update document still referenced
                (<Model<any>>revModelFactory.model).update({ _id: { $in: refIds } }, update, { multi: true });


                let update2;
                if (field.isPlural) {
                    update2 = { $pull: {} };
                    update2.$pull[revKey] = { $in: [_id] };
                } else {
                    update2 = { $unset: {} };
                    update2.$unset[revKey] = 1;
                }
                //console.log("Update2: "+JSON.stringify({ _id: { $nin: refIds}})+":"+JSON.stringify(update2);

                // update documents not referenced anymore
                (<Model<any>>revModelFactory.model).update({ _id: { $nin: refIds } }, update2, { multi: true });
            }
        }
    }

    private populateQuery(query: Query<any>, includes: any): any[] {
        let skippedPopulates = [];
        for (let include of includes) {
            // do not apply populate for embedded references
            if (this.modelFactory.$prototype[include.path] && !this.modelFactory.$prototype[include.path].embedded) {
                let mf = <IMongoModelFactory>this.modelFactory.getModelFactoryByPath(include.path);
                // use mongoose populate for same datasource
                if (mf.datasource === this.modelFactory.datasource) {
                    include.model = mf.model;
                    // populate is done here !!!
                    query = query.populate(include);
                }
                // but use home made populate for distinct datasources
                else {
                    skippedPopulates.push(include.path);
                }
            }
        }
        return skippedPopulates;
    }
}