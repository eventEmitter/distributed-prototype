(function() {
    'use strict';


    const log = require('ee-log');
    const type = require('ee-types');
    const RPCRequest = require('ee-soa-rpc-request');
    const RelationalRequest = require('./RelationalRequest');
    const RelationalResponse = require('./RelationalResponse');
    const FilterBuilder = require('./FilterBuilder');
    const RelationalSelection = require('./RelationalSelection');



    const statusCodeMap = new Map();
    statusCodeMap.set('ok', 1);
    statusCodeMap.set('created', 2);
    statusCodeMap.set('notFound', 26);
    statusCodeMap.set('error', 37);
    statusCodeMap.set('invalidAction', 27);
    statusCodeMap.set('badRequest', 23);
    statusCodeMap.set('serviceUnavailable', 38);
    statusCodeMap.set('forbidden', 25);


    const debug = process.argv.indexOf('debug-service') >= 0 || process.env.debugService;



    module.exports = class LegacyRequestTranslator {


        constructor() {

            // needed to convert to legacy
            this.RPCRequest = new RPCRequest(this);
        }






        fromLegacy(legacyRequest, legacyResponse) {
            let request, response;


            try {
                response = this.convertIncomingResponse(legacyResponse)
                request = this.convertIncomingRequest(legacyRequest);
            } catch (err) {
                if (debug) log(err);
                legacyResponse.send(37, `Failed to translate legacy to distributed request: ${err.message}`);
                return Promise.reject(err);
            }

            return Promise.resolve({
                  request  : request
                , response : response
            });
        }







        toLegacy(request, response) {
            let url = '/';

            // add service if not explicitly legacy is addressed
            url += request.getService() === 'legacy' ? '' : request.getService()+'.';

            // add the resource
            url += `/${request.resource}`;

            // add the id if present
            if (request.hasResourceId()) url += `/${request.getResourceId()}`;


            // add remote service if not explicitly legacy is addressed
            if (request.hasRemoteService()) url += request.getRemoteService() === 'legacy' ? '' : request.getRemoteService()+'.';

            // add the resource
            if (request.hasRemoteResource()) url += `/${request.getRemoteResource()}`;

            // add the id if present
            if (request.hasRemoteResourceId()) url += `/${request.getRemoteResourceId()}`;


            return new this.RPCRequest({
                  filter        : this.convertToLegacyFilter(request.filter)
                , select        : this.convertToLegaySelection(request)
                , languages     : request.languages
                , data          : request.data
                , url           : url
            }).convert().then((result) => {

                // get results
                result.response.on('end', (status, data) => {
                    response.data = data;

                    switch (status) {
                        case 1: return response.ok(data);
                        case 2: return response.created(data.id);
                        case 38: return response.error('legacy_error', `The legacy layer returned an error!`, data.err);
                        default: return response.error('legacy_error', `The legacy layer returned an unknown status ${status}!`, data.err);
                    }
                });

                return Promise.resolve(result);
            }).catch((err) => {
                if (debug) log(err);
                response.error('legacy_error', `The legacy layer failed to convert the request`, err);
                return Promise.reject(err);
            });
        }










        convertToLegaySelection(request) {
            let selects = request.selection;
            if (request.hasRelationalSelection()) this.convertToLegayRelationalSelection({children: request.relationalSelections}, selects, '');
            return selects ? selects.join(', ') : '';
        }



        convertToLegayRelationalSelection(selection, selects, path) {
            if (selection.children) {
                selection.children.forEach((childSelection) => {
                    if (childSelection.hasFilter()) throw new Error(`Cannot convert subrequests with filters!`);
                    if (childSelection.hasSelection()) childSelection.selection.forEach(s => selects.push(`${path}.${s}`));
                    this.convertToLegayRelationalSelection(childSelection, selects, `${path}${(path.length ? '.' : '')}${childSelection.resource}`);
                });
            }
        }






        convertToLegacyFilter(filter) {
            if (filter) {
                switch(filter.type) {

                    case 'or':
                        throw new Error(`Cannot convert or filter to legacy format!`);



                    case 'and':
                    case 'entity':
                    case 'root':
                        if (filter.children.length > 1) {
                            const andChildren = [];
                            for (const child of filter.children) {
                                andChildren.push(this.convertToLegacyFilter(child));
                            }
                            return andChildren.join(', ');
                        }
                        else if (filter.children.length === 1) return this.convertToLegacyFilter(filter.children[0]);
                        else return null;




                    case 'property':
                        if (filter.children.length === 0) return null;
                        else if (filter.children.length > 1) throw new Error(`Cannot build property filter with more than on child!`);
                        else return this.convertToLegacyFilter(filter.children[0]);



                    case 'comparator':
                        if (filter.children.length === 0) return null;
                        else if (filter.children.length > 1) throw new Error(`Cannot build comparator filter with more than on child!`);
                        else return filter.comparator;


                    case 'function':
                        if (filter.children.length === 0) return null;
                        else if (filter.children.length > 1) throw new Error(`Cannot build comparator filter with more than on child!`);
                        else return `${filter.functionName}(${this.convertToLegacyFilter(filter.children[0])})`;



                    case 'value':
                        return filter.nodeValue+'';
                }
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









        convertIncomingResponse(legacyResponse) {
            const response = new RelationalResponse();
            let errorData;


            response.onSend = () => {
                if (debug) {
                    log.info(`response: status -> ${response.status}, message -> ${response.message}`);
                    if (response.err) log(err);
                }

                switch(response.status) {
                    case 'created':
                        legacyResponse.setHeader('Location', `/${response.data.resourceName}/${response.data.id}`);
                        break;

                    case 'invalidAction':
                    case 'notFound':
                        errorData = `Failed to execute the ${response.actionName} action on ${response.serviceName}/${response.resourceName}: ${response.message}`
                        break;

                    case 'badRequest':
                    case 'serviceUnavailable':
                    case 'forbidden':
                        errorData = `Failed to execute the ${response.actionName} action on ${response.serviceName}/${response.resourceName}: ${response.message} (${response.code})`
                        break;

                    case 'error':
                        errorData = `Failed to execute the ${response.actionName} action on ${response.serviceName}/${response.resourceName}: ${response.message} (${response.code}) ${response.error ? ' ('+response.error.message+')' : ''}`
                        break;
                }

                process.nextTick(() => {
                    legacyResponse.send(statusCodeMap.get(response.status), errorData || response.data);
                });
            };


            return response;
        }











        convertIncomingRequest(legacyRequest) {
            let action = legacyRequest.getActionName();

            // relation stuff
            if (action === 'create' && legacyRequest.hasRelatedTo()) action = 'createRelation';
            if (action === 'createOrUpdate' && legacyRequest.hasRelatedTo()) action = 'createOrUpdateRelation';
            if (action === 'update' && legacyRequest.hasRelatedTo()) action = 'updateRelation';
            if (action === 'delete' && legacyRequest.hasRelatedTo()) action = 'deleteRelation';

            // bulk operations
            if (action === 'delete' && legacyRequest.hasResourceId()) action = 'deleteOne';
            if (action === 'update' && legacyRequest.hasResourceId()) action = 'updateOne';
            if (action === 'create' && !type.array(legacyRequest.content)) action = 'createOne';
            if (action === 'createRelation' && !type.array(legacyRequest.content)) action = 'createOneRelation';
            if (action === 'createOrUpdateRelation' && !type.array(legacyRequest.content)) action = 'createOrUpdateOneRelation';
            if (action === 'updateRelation' && legacyRequest.hasResourceId()) action = 'updateOneRelation';
            if (action === 'deleteRelation' && legacyRequest.hasResourceId()) action = 'deleteOneRelation';

            const tokens = legacyRequest.accessTokens ? legacyRequest.accessTokens : (legacyRequest.accessToken ? [legacyRequest.accessToken] : []);

            // limit & offset. it's implemented wrong anyway on legacy :/
            const range = legacyRequest.getRange();


            if (debug) {
                log.info(`service-bridge: converting legacy to distributed request ...`);
                log.debug(`legacy request: action -> ${legacyRequest.getActionName()}, resource -> ${legacyRequest.collection}, resourceId -> ${legacyRequest.resourceId}, remoteResource -> ${(legacyRequest.relatedTo ? legacyRequest.relatedTo.model : undefined)}, remoteResourceId -> ${(legacyRequest.relatedTo ? legacyRequest.relatedTo.id : undefined)}`);
            }

            // extract servicename
            let service;
            const index = legacyRequest.collection.indexOf('.');
            if (index >= 0) {
                service = legacyRequest.collection.substr(0, index);
                legacyRequest.collection = legacyRequest.collection.substr(index+1);
            }


            // remote servicename
            let remoteService;
            let remoteResource;
            if (legacyRequest.relatedTo && legacyRequest.relatedTo.model) {
                remoteResource = legacyRequest.relatedTo.model;


                const remoteIndex = remoteResource.indexOf('.');
                if (remoteIndex >= 0) {
                    remoteService = remoteResource.substr(0, remoteIndex);
                    remoteResource = remoteResource.substr(remoteIndex+1);
                }
            }



            const request = new RelationalRequest({
                  resource              : legacyRequest.collection
                , action                : action
                , service               : service
                , resourceId            : legacyRequest.resourceId
                , remoteResource        : remoteResource
                , remoteResourceId      : legacyRequest.relatedTo ? legacyRequest.relatedTo.id : undefined
                , remoteService         : remoteService
                , filter                : this.convertIncomingFilter(legacyRequest, service)
                , selection             : legacyRequest.getFields()
                , relationalSelection   : this.convertIncomingRelationalSelection(legacyRequest, service)
                , data                  : legacyRequest.content
                , tokens                : tokens
                , limit                 : ((range && range.to !== null) ? (range.to - (range.from || 0) + 1) : null)
                , offset                : (range ? (range.from || 0) : null)
                , options               : legacyRequest.getParameters()
            });


            if (debug) {
                log.debug(`distributed request: action -> ${request.getAction()}, service -> ${request.getService()}, resource -> ${request.getResource()}, resourceId -> ${request.getResourceId()}, remoteService -> ${request.getRemoteService()}, remoteResource -> ${(request.getRemoteResource())}, remoteResourceId -> ${(request.getRemoteResourceId())}`);
            }

            return request;
        }










        convertIncomingRelationalSelection(request, service) {
            const selections = this.convertIncomingSelection(request, service);

            // store them, they may be used later
            const relationalSelection = new Map();


            if (selections && selections.length) {
                selections.forEach((selection) => {
                    relationalSelection.set(selection.resource, selection);
                });
            }

            return relationalSelection;
        }



        convertIncomingSelection(request, service) {
            const selections = [];


            if (request.hasSubRequests()) {
                request.getSubRequests().forEach((subRequest) => {

                    // check for containedd service in the collection
                    let resource = subRequest.getCollection();
                    const index = resource.indexOf('.');

                    if (index >= 0) {
                        service = resource.susbtr(0, index);
                        resource = resource.susbtr(index+1);
                    }



                    const selection = new RelationalSelection({
                          selection     : subRequest.getFields()
                        , filter        : this.convertIncomingObjectTree(subRequest.getFilters(), new FilterBuilder())
                        , resource      : resource
                        , service       : service
                    });

                    selections.push(selection);

                    const subSelections = this.convertIncomingSelection(subRequest);
                    if (subSelections && subSelections.length) selection.addSubSelections(subSelections);
                });
            }

            return selections;
        }











        convertIncomingFilter(request) {
            const filter = new FilterBuilder();
            this.convertIncomingObjectTree(request.getFilters(), filter);
            return filter && filter.children.length ? filter: null;
        }



        convertIncomingFilters(filters, filterBuilder) {
            if (type.array(filters)) {
                if (filters.length > 1) {
                    const andBuilder = filterBuilder.and();

                    filters.forEach((filter) => {
                        this.convertIncomingFilters(filter, andBuilder);
                    });
                }
                else if (filters.length === 1) return this.convertIncomingFilters(filters[0], filterBuilder);
                else return;
            }
            else if (type.object(filters)) {

                // actual filter
                const comparatorFilter = filterBuilder.comparator(filters.operator);

                if (type.function(filters.value)) {
                    const result = filters.value();
                    comparatorFilter.fn(result.name, result.parameters);
                }
                else comparatorFilter.value(filters.value);
            }
        }



        convertIncomingObjectTree(filters, filterBuilder) {
            if (type.object(filters)) {
                const keys = Object.keys(filters);

                if (keys.length > 1) filterBuilder = filterBuilder.and();

                keys.forEach((key) => {
                    const value = filters[key];

                    if (type.object(value)) {
                        // we are an enitiy

                        this.convertIncomingObjectTree(value, filterBuilder.entity(key));
                    }
                    else if (type.array(value)) {

                        // we are the property
                        this.convertIncomingFilters(value, filterBuilder.property(key));
                    }
                });
            } else this.convertIncomingFilters(filters, filterBuilder);
        }
    }
})();