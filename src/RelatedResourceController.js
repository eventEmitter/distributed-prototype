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






    module.exports = class RelatedResourceController extends RelationalResourceController {


        constructor(options, name) {
            super(name);

            this.db = options.db;
            this.Related = options.Related;

            this.enableActions();
        }




        enableActions() {
            this.enableAction('list');
            this.enableAction('listOne');
            this.enableAction('create');
            this.enableAction('createOne');
            this.enableAction('delete');
            this.enableAction('deleteOne');
            this.enableAction('update');
            this.enableAction('updateOne');
            this.enableAction('createRelation');
        }










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

            // create query, apply my filters
            const query = this.db[this.tableName](request.selection);

            // let the user apply filters
            this.applyFilter(query, request.filter);

            // apply limit & offset
            if (request.limit) query.limit(request.limit);
            if (request.offset) query.offset(request.offset);

            // get data
            query.raw().find().then((data) => {

                // load related dats selectedd by the user
                this.loadRelationanlSelections(request, data).then(() => {

                    // remove ids for references
                    this.removeReferenceIds(data, request.requestingResource);

                    // k, there you go!
                    response.ok(data);
                }).catch(err => response.error('query_error', `Failed to load relational selection!`, err));
            }).catch(err => response.error('db_error', `Failed to load ${this.name} resource!`, err));
        }








        resolveRelations(data) {
            return super.resolveRelations(data).then(() => {
                Object.keys(data).forEach((key) => {
                    if (type.array(data[key]) && this.relations.has(key)) {
                        const relationDefinition = this.relations.get(key);

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
                          type          : column.type
                        , nullable      : column.nullable || column.isAutoIncrementing || column.defaultValue
                        , isPrimary     : column.isPrimary
                    });
                });



                Object.keys(tableDefinition.columns).forEach((columnName) => {
                    const column = tableDefinition.columns[columnName];


                    if (type.object(column.referencedModel)) {
                        this.registerReference(column.referencedModel.alias || column.referencedTable, {
                              localProperty: column.name
                            , remoteResource: column.referencedModel.alias || column.referencedTable
                            , remoteResourceProperty: column.referencedColumn
                        });
                    }


                    if (type.array(column.belongsTo)) {
                        column.belongsTo.forEach((belongsToDefinition) => {
                            this.registerBelongsTo(belongsToDefinition.name, {
                                  localProperty: column.name
                                , remoteResource: belongsToDefinition.model.alias || belongsToDefinition.name
                                , remoteResourceProperty: belongsToDefinition.targetColumn
                            });
                        });
                    }


                    if (type.array(column.mapsTo)) {
                        column.mapsTo.forEach((mappingDefinition) => {
                            this.registerMapping((mappingDefinition.aliasName || mappingDefinition.name), {
                                  localProperty             : column.name
                                , remoteResource            : mappingDefinition.model.name
                                , remoteResourceProperty    : mappingDefinition.column.name
                                , viaResource               : mappingDefinition.via.model.name
                                , viaResourceLocalProperty  : mappingDefinition.via.fk
                                , viaResourceRemoteProperty : mappingDefinition.via.otherFk
                                , viaAlias                  : mappingDefinition.via.model.alias || mappingDefinition.via.model.name
                            });
                        });
                    }
                });


                return Promise.resolve();
            }
            else return Promise.reject(`Cannot autoload related controller ${this.tableName}. It does not exist in the database!`);
        }







        applyFilter(query, filter) {
            if (!filter) return;
            const relatedFilter = this.applyRelatedFilter(filter);
            if (relatedFilter) query.queryBuilder().and(relatedFilter);
        }



        applyRelatedFilter(filter) {
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
                        if (filter.comparator === '!=' && type.array(filter.children[0])) filter.comparator = 'notIn';
                        if (filter.comparator === '=' && type.array(filter.children[0])) filter.comparator = 'in';

                        // check for null values
                        if (filter.comparator === '!=' && type.array(filter.children) && filter.children.length === 1 && filter.children[0].type === 'value' && filter.children[0].nodeValue === null) return this.Related[comparators.get('notNull')]();
                        if (filter.comparator === '=' && type.array(filter.children) && filter.children.length === 1 && filter.children[0].type === 'value' && filter.children[0].nodeValue === null) return this.Related[comparators.get('isNull')]();

                        // check for nullvalues using functions
                        if (filter.comparator === '=' && type.array(filter.children) && filter.children.length === 1 && filter.children[0].type === 'function' && filter.children[0].functionName === 'isNull') return this.Related[comparators.get('isNull')]();
                        if (filter.comparator === '=' && type.array(filter.children) && filter.children.length === 1 && filter.children[0].type === 'function' && filter.children[0].functionName === 'notNull') return this.Related[comparators.get('notNull')]();

                        if (comparators.has(filter.comparator)) return this.Related[comparators.get(filter.comparator)](this.applyRelatedFilter(filter.children[0]));
                        else throw new Error(`Invalid comparator ${filter.comparator}!`);
                    }



                case 'function':
                    if (filter.children.length === 0) return null;
                    else if (filter.children.length > 1) throw new Error(`Cannot build function filter with more than on child!`);
                    else {
                        if (comparators.has(filter.functionName)) return this.Related[comparators.get(filter.functionName)](this.applyRelatedFilter(filter.children[0]));
                        else throw new Error(`Invalid function ${filter.functionName}!`);
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
