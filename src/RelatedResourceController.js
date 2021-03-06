(function() {
    'use strict';


    const RelationalResourceController = require('./RelationalResourceController');
    const FilterBuilder = require('./FilterBuilder');
    const log = require('ee-log');
    const type = require('ee-types');





    // operator whitelist
    const comparators = new Map();

    comparators.set('>', 'gt');
    comparators.set('<', 'lt');
    comparators.set('>=', 'gte');
    comparators.set('<=', 'lte');
    comparators.set('!=', 'notEqual');
    comparators.set('=', 'equal');

    comparators.set('like', 'like');
    comparators.set('notLike', 'notLike');
    comparators.set('in', 'in');
    comparators.set('notIn', 'notIn');
    comparators.set('notNull', 'notNull');
    comparators.set('isNull', 'isNull');
    comparators.set('equal', 'equal');
    comparators.set('not', 'not');
    comparators.set('is', 'is');
    comparators.set('jsonValue', 'jsonValue');









    module.exports = class RelatedResourceController extends RelationalResourceController {


        constructor(options, name) {
            super(name);

            if (!options || !options.db) throw new Error(`Please pass an options object containing a db property to the '${name}' related controller!`);

            this.db = options.db;
            this.Related = options.Related;

            this.enableActions();
        }






        enableActions() {
            this.enableAction('create');
            this.enableAction('createOne');
            this.enableAction('createOneRelation');
            this.enableAction('createOrUpdate');
            this.enableAction('createOrUpdateOne');
            this.enableAction('createOrUpdateOneRelation');
            this.enableAction('createRelation');
            this.enableAction('delete');
            this.enableAction('deleteOne');
            this.enableAction('deleteOneRelation');
            this.enableAction('describe');
            this.enableAction('list');
            this.enableAction('listOne');
            this.enableAction('update');
            this.enableAction('updateOne');
            this.enableAction('updateOneRelation');
        }





/*



        createOrUpdateOneRelation(request, response) {



            if (this.hasRelation(request.remoteService, request.remoteResource)) {
                const relation = this.getRelation(request.remoteService, request.remoteResource);

                if (relation.type === 'reference') {
                    new RelationalRequest({
                          action        : 'updateOne'
                        , service       : this.getServiceName()
                        , resource      : this.getName()
                        , resourceId    : request.resourceId
                        , {

                        }
                    }).send(this).then(() => )
                }
            } else response.badRequest('invalid_relation', `The relation '${request.remoteResource}' does not exist on the '${this.getName()}' resource!`);
        }





*/





        delete(request, response) {

            // create query, apply my filters
            const query = this.db[this.tableName]();

            // let the user apply filters
            this.applyFilter(query, request.filter);

            // apply limit & offset
            if (request.limit) query.limit(request.limit);
            if (request.offset) query.offset(request.offset);

            if (request.hasOption('softDelete') && request.getOption('softDelete') == false && type.function(query.includeSoftDeleted)) query.includeSoftDeleted();

            // get data
            query.delete().then(() => {

                // load related dats selected by the user
                response.ok();
            }).catch(err => response.error('db_error', `Failed to delete resource!`, err));
        }










        create(request, response) {
            if (!this.db[this.tableName]) response.error('db_error', `the ${this.tableName} table does not exist!`);
            else if (!type.array(request.data)) response.badRequest('invalid_bulk_payload', `cannot bulk create ${this.name} resources, expected an array, got ${type(request.data)}`);
            else {

                const transaction = this.db.createTransaction();

                // bulk create
                Promise.all(request.data.map((data, index) => {
                    return this.resolveRelations(data).then(() => {

                        return new transaction[this.tableName](data).save().then((record) => {
                            if (this.definition.hasPrimaryIds()) {
                                if (this.definition.primaryIds.length === 1) return Promise.resolve(record[this.definition.primaryIds]);
                                else return Promise.resolve(this.definition.primaryIds.map(name => record[name]));
                            } else return Promise.resolve();
                        });
                    });
                })).then((ids) => {
                    return transaction.commit().then(() => {
                        response.created(ids);
                    });
                }).catch(err => response.error('db_error', `Failed to create resource!`, err));
            }
        }










        update(request, response) {
            // so, since mysql isn't able to return updated ids we're
            // loading all data and update each individual record. the only
            // exception to this is if the resource doesn't hava any primary
            // keys. we will cannot return the updated ids in that case anyway


            this.resolveRelations(request.data).then(() => {
                if (this.definition.hasPrimaryIds()) {
                    // load records, update them, return the ids


                    // need a transaction, so we're sure in what is getting updated
                    const transaction = this.db.createTransaction();

                    // current page offset
                    let offset = 0;

                    // the users offset
                    const requestOffset = type.number(request.offset) ? request.offset : 0;

                    // how many records to load per page
                    const pageSize = 100;

                    // keys of the data to apply to each record
                    const keys = Object.keys(request.data);

                    // the ids to return
                    const ids = [];



                    // we're paging, else we may get big time problems
                    // this is the handler function for that
                    const pagedUpdate = () => {

                        // create query, apply my filters
                        const query = transaction[this.tableName](this.definition.primaryIds);

                        this.applyFilter(query, request.filter);

                        // set the limit requested by the user
                        if (request.limit) query.limit(request.limit);

                        // set the current offset computed out of the
                        // users offset and our current page
                        query.offset(requestOffset + offset);

                        // load from db
                        return query.find().then((records) => {
                            if (!records.length) return Promise.resolve();
                            else {

                                // apply update to all records
                                records.forEach((record) => {

                                    // empty integers that are delivered as empty strings must be set to null
                                    if (request.data && typeof request.data === 'object' && request.data !== null) {
                                        for (const property of this.definition.properties.values()) {
                                            if (request.data[property.name] === '' && (
                                                property.representation === 'number' ||
                                                property.type === 'interval'
                                            )) {
                                                request.data[property.name] = null;
                                            }
                                        }
                                    }

                                    record.setValues(request.data);

                                    if (this.definition.hasPrimaryId()) ids.push(record[this.definition.primaryId]);
                                    else ids.push(this.definition.primaryIds.map(name => record[name]));
                                });

                                // save all
                                return Promise.all(records.map(r => r.save())).then(() => {
                                    if (records.length < pageSize) return Promise.resolve();
                                    else {
                                        offset += pageSize;
                                        return pagedUpdate();
                                    }
                                });
                            }
                        });
                    };


                    pagedUpdate().then(() => {

                        // looks good, commit
                        return transaction.commit().then(() => {

                            // nice, return ids of all update records
                            response.noContent(ids);
                        });
                    }).catch(err => response.error('db_error', `Failed to update resource!`, err));

                } else {
                    // do a bulk update, return nothing
                    const bulkUpdate = transaction[this.tableName]();

                    // let the user apply filters
                    this.applyFilter(bulkUpdate, request.filter);

                    // apply limit & offset
                    if (request.limit) bulkUpdate.limit(request.limit);
                    if (request.offset) bulkUpdate.limit(request.offset);

                    bulkUpdate.update(request.data).then(() => {

                        // return nothing
                        response.noContent();
                    }).catch(err => response.error('db_error', `Failed to update resource!`, err));
                }
            }).catch(err => response.error('db_error', `Failed to resolve referenced resources!`, err));

        }








        list(request, response) {

            // add the primary keys
            if (this.definition.hasPrimaryIds()) this.definition.primaryIds.forEach(id => request.addSelection(id));


            // we need to select foreign keys if we're 
            // loading references
            this.prepareSelection(request);


            // extract fields that are not properties of this entity
            const foreignSelections = new Set();
            const localSelections = new Set();

            for (const property of request.getSelection()) {
                if (property === '*') {
                    foreignSelections.add('*');
                    localSelections.add('*');
                } else if (typeof property === 'object') {
                    localSelections.add(property);
                } else {
                    if (this.definition.hasProperty(property)) localSelections.add(property);
                    else foreignSelections.add(property);
                } 
            }


            // create query, apply my filters
            const query = this.db[this.tableName]([]);

            // apply selection
            this.applySelection(query, localSelections);

            // let the user apply filters
            this.applyFilter(query, request.filter);

            // apply limit & offset
            if (request.limit) query.limit(request.limit);
            if (request.offset) query.offset(request.offset);


            // ordering
            if (request.hasOrder()) {
                for (const order of request.getOrder()) {
                    if (order.desc) query.orderDesc(order.property);
                    else query.order(order.property);
                }
            }



            // get data
            query.raw().find().then((data) => {
                return response.executeHook('afterListQuery', data).then(() => {

                    // load related dats selected by the user
                    this.loadRelationanlSelections(request, data).then(() => { 

                        // load locale data
                        this.loadLocaleData({
                              languages: request.getLanguages()
                            , records: data
                            , selection: foreignSelections
                        }).then(() => {

                            // remove ids for references
                            this.removeReferenceIds(data, request.requestingResource, request.selection);

                            // k, there you go!
                            response.ok(data);
                        }).catch(err => response.error('locale_error', `Failed to load locale data: ${err.message}`, err));
                    }).catch(err => response.error('query_error', `Failed to load relational selection!`, err));
                });
            }).catch(err => response.error('db_error', `Failed to load ${this.name} resource!`, err));
        }







        /**
        * apply selection sets to the query
        */
        applySelection(query, selectionSet) {
            const parsedSelections = [];

            for (const selection of selectionSet.values()) {
                if (typeof selection === 'string') parsedSelections.push(selection);
                else if (typeof selection === 'object') {

                    // selection function
                    if (selection.functionName === 'referenceCount') {
                        parsedSelections.push(this.Related.select(selection.alias).referenceCount(selection.functionParameters[0]));
                    } else throw new Error(`The selection function ${selection.functionName} is not supported by the framework!`);
                } else throw new Error(`The selection of the type '${type(selection)} is not supported by the framework!`);
            }

            query.select(parsedSelections);
        }








        resolveRelations(data) {
            return super.resolveRelations(data).then(() => {
                Object.keys(data).forEach((key) => {
                    if (type.array(data[key]) && this.hasRelation(this.getServiceName(), key)) {
                        const relationDefinition = this.getRelation(this.getServiceName(), key);

                        if (relationDefinition.type === 'mapping') {
                            data[relationDefinition.via.resource] = data[key].map((item) => {
                                const itemData = {};
                                itemData[relationDefinition.via.remoteProperty] = item[relationDefinition.remote.property];
                                return new this.db[relationDefinition.via.resource](itemData);
                            });

                            delete data[key];
                        }
                    }
                });

                return Promise.resolve();
            });
        }










        load(tableName) {
            this.tableName = tableName;

            const definition = this.db.getDefinition();

            if (type.object(definition[this.tableName])) {
                const tableDefinition = definition[this.tableName];


                // register primary ids
                this.definition.setPrimaryIds(tableDefinition.primaryKeys);


                // register columnds
                Object.keys(tableDefinition.columns).forEach((columnName) => {
                    const column = tableDefinition.columns[columnName];


                    this.definition.addProperty(columnName, {
                          type              : column.type
                        , representation    : column.jsTypeMapping
                        , nullable          : column.nullable || column.isAutoIncrementing || column.defaultValue
                        , isPrimary         : column.isPrimary
                    });
                });



                Object.keys(tableDefinition.columns).forEach((columnName) => {
                    const column = tableDefinition.columns[columnName];


                    if (type.object(column.referencedModel)) {
                        this.registerReference(column.referencedModel.alias || column.referencedTable, {
                              property                  : column.name
                            , remote: {
                                  resource              : column.referencedModel.alias || column.referencedTable
                                , property              : column.referencedColumn
                                , service               : this.getServiceName()
                            }
                        });
                    }


                    if (type.array(column.belongsTo)) {
                        column.belongsTo.forEach((belongsToDefinition) => {
                            this.registerBelongsTo(belongsToDefinition.aliasName || belongsToDefinition.name, {
                                  property              : column.name
                                , remote: {
                                      resource          : belongsToDefinition.model.alias || belongsToDefinition.name
                                    , property          : belongsToDefinition.targetColumn
                                    , service           : this.getServiceName()
                                }
                            });
                        });
                    }


                    if (type.array(column.mapsTo)) {
                        column.mapsTo.forEach((mappingDefinition) => {
                            this.registerMapping((mappingDefinition.aliasName || mappingDefinition.name), {
                                  property              : column.name
                                , remote: {
                                      resource          : mappingDefinition.model.name
                                    , property          : mappingDefinition.column.name
                                    , service           : this.getServiceName()
                                }
                                , via: {
                                      resource          : mappingDefinition.via.model.name
                                    , localProperty     : mappingDefinition.via.fk
                                    , remoteProperty    : mappingDefinition.via.otherFk
                                    , service           : this.getServiceName()
                                    , alias             : mappingDefinition.via.model.alias || mappingDefinition.via.model.name
                                }
                            });
                        });
                    }
                });


                return Promise.resolve();
            } else return Promise.reject(`Cannot load related controller ${this.getName()} on the table ${this.tableName}. It does not exist in the database!`);
        }







        applyFilter(query, filter) {
            if (filter) {
                if (query.buildFilter) query.buildFilter(filter);
                else {
                    const relatedFilter = this.applyRelatedFilter(filter);
                    if (relatedFilter) query.queryBuilder().and(relatedFilter);
                }
            }
        }





        applyRelatedFilter(filter) {//log(filter);
            switch(filter.type) {

                case 'or':
                    const orChildren = [];
                    for (const child of filter.children) {
                        orChildren.push(this.applyRelatedFilter(child));
                    }
                    return this.Related.or(orChildren);



                case 'and':
                case 'entity':
                case 'root':
                    if (filter.children.length > 1) {
                        const andChildren = [];
                        for (const child of filter.children) {
                            andChildren.push(this.applyRelatedFilter(child));
                        }
                        return this.Related.and(andChildren);
                    }
                    else if (filter.children.length === 1) return this.applyRelatedFilter(filter.children[0]);
                    else return null;




                case 'property':
                    if (filter.children.length === 0) return null;
                    else if (filter.children.length > 1) throw new Error(`Cannot build property filter with more than on child!`);
                    else {
                        const relatedFilter = {};
                        const path = this.getEntityPath(filter);
                        relatedFilter[path] = this.applyRelatedFilter(filter.children[0]);
                        return relatedFilter;
                    }



                case 'comparator':
                    if (filter.children.length === 0) return null;
                    else if (filter.children.length > 1) throw new Error(`Cannot build comparator filter with more than on child!`);
                    else {

                        // check for null values
                        if (filter.comparator === '!=' && filter.children[0].type === 'value' && filter.children[0].nodeValue === null) return this.Related[comparators.get('notNull')]();
                        if (filter.comparator === '=' && filter.children[0].type === 'value' && filter.children[0].nodeValue === null) return this.Related[comparators.get('isNull')]();

                        //log(filter.comparator, comparators.get(filter.comparator), this.applyRelatedFilter(filter.children[0]));
                        if (comparators.has(filter.comparator)) return this.Related[comparators.get(filter.comparator)](this.applyRelatedFilter(filter.children[0]));
                        else throw new Error(`Invalid comparator ${filter.comparator}!`);
                    }



                case 'function':
                    if (filter.children.length === 0) return null;
                    else {
                        if (comparators.has(filter.functionName)) {
                            const fn = this.Related[comparators.get(filter.functionName)];
                            const parameters = filter.children.map(child => this.applyRelatedFilter(child));
                            return fn.apply(this.Related, parameters);
                        }
                        else throw new Error(`Invalid function ${filter.functionName}. Please use one of the following functions: ${Array.from(comparators.values()).join(', ')}!`);
                    }



                case 'value':
                    return filter.nodeValue;
            }
        }






        getEntityPath(filter) {
            let currentNode = '';
            if (filter.type === 'entity') currentNode = filter.entityName;
            else if (filter.type === 'property') currentNode = filter.propertyName;

            if (filter.parent) {
                const parentPath = this.getEntityPath(filter.parent);
                if (parentPath.length) return `${parentPath}${(parentPath[parentPath.length -1] === '.' ? '' : '.')}${currentNode}`;
                else return currentNode;
            }
            else return currentNode;
        }
    };
})();
