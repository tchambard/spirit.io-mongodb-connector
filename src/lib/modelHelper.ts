import { IModelFactory, IModelHelper, IParameters, ISerializeOptions } from 'spirit.io/lib/interfaces';
import { ModelHelperBase } from 'spirit.io/lib/base';

export class ModelHelper extends ModelHelperBase implements IModelHelper {
    constructor(modelFactory: IModelFactory) {
        super(modelFactory);
    }
}