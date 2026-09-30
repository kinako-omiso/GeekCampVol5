#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <tuple>
#include <unordered_map>
#include <vector>

namespace {
constexpr double EPS = 1e-7;
constexpr double PI = 3.14159265358979323846;
struct V { double x, y, z; };
V operator+(V a,V b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
V operator-(V a,V b){return {a.x-b.x,a.y-b.y,a.z-b.z};}
V operator*(V a,double s){return {a.x*s,a.y*s,a.z*s};}
double dot(V a,V b){return a.x*b.x+a.y*b.y+a.z*b.z;}
V cross(V a,V b){return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x};}
double norm(V a){return std::sqrt(dot(a,a));}
double clamp01(double x){return std::max(0.0,std::min(1.0,x));}
struct Face { int a,b,c; V normal; std::vector<int> outside; bool alive=true; };
std::vector<float> hullPositions;
std::vector<uint32_t> hullIndices;
std::array<double,21> values{};
Face faceOf(int a,int b,int c,const std::vector<V>& pts,V inner){
  V n=cross(pts[b]-pts[a],pts[c]-pts[a]);
  if(dot(n,inner-pts[a])>0){std::swap(b,c);n=n*(-1);}
  double len=norm(n); return {a,b,c,len>EPS?n*(1/len):V{0,0,0},{},true};
}
double distance(const Face& f,V p,const std::vector<V>& pts){return dot(f.normal,p-pts[f.a]);}

// 3D QuickHull。点を可視面の外側集合に割り当てて更新する。
bool quickHull(const std::vector<V>& pts,double& hullVolume){
  hullPositions.clear();hullIndices.clear();hullVolume=0;
  if(pts.size()<4) return false;
  int a=0,b=0,c=-1,d=-1;
  for(int i=1;i<(int)pts.size();++i){if(pts[i].x<pts[a].x)a=i;if(pts[i].x>pts[b].x)b=i;}
  if(norm(pts[b]-pts[a])<EPS) return false;
  double best=EPS;
  for(int i=0;i<(int)pts.size();++i){double n=norm(cross(pts[i]-pts[a],pts[b]-pts[a]));if(n>best){best=n;c=i;}}
  if(c<0)return false;
  best=EPS;V plane=cross(pts[b]-pts[a],pts[c]-pts[a]);
  for(int i=0;i<(int)pts.size();++i){double n=std::abs(dot(plane,pts[i]-pts[a]));if(n>best){best=n;d=i;}}
  if(d<0)return false;
  V inner=(pts[a]+pts[b]+pts[c]+pts[d])*0.25;
  std::vector<Face> faces;
  faces.push_back(faceOf(a,b,c,pts,inner));faces.push_back(faceOf(a,d,b,pts,inner));
  faces.push_back(faceOf(a,c,d,pts,inner));faces.push_back(faceOf(b,d,c,pts,inner));
  for(int i=0;i<(int)pts.size();++i){
    if(i==a||i==b||i==c||i==d)continue;
    double maxD=EPS;int owner=-1;
    for(int j=0;j<4;++j){double gap=distance(faces[j],pts[i],pts);if(gap>maxD){maxD=gap;owner=j;}}
    if(owner>=0)faces[owner].outside.push_back(i);
  }
  for(int iteration=0;iteration<20000;++iteration){
    int chosen=-1,point=-1;double farthest=EPS;
    for(int j=0;j<(int)faces.size();++j)if(faces[j].alive){
      for(int i:faces[j].outside){double gap=distance(faces[j],pts[i],pts);if(gap>farthest){farthest=gap;chosen=j;point=i;}}
    }
    if(chosen<0)break;
    std::vector<int> visible, reassess;
    std::map<std::pair<int,int>,std::pair<int,int>> boundary;
    for(int j=0;j<(int)faces.size();++j){
      if(!faces[j].alive||distance(faces[j],pts[point],pts)<=EPS)continue;
      visible.push_back(j);
      auto& f=faces[j];reassess.insert(reassess.end(),f.outside.begin(),f.outside.end());
      std::array<std::pair<int,int>,3> edges={{{f.a,f.b},{f.b,f.c},{f.c,f.a}}};
      for(auto edge:edges){auto key=std::minmax(edge.first,edge.second);auto it=boundary.find(key);
        if(it==boundary.end())boundary[key]=edge;else boundary.erase(it);}
    }
    if(visible.empty())return false;
    for(int j:visible){faces[j].alive=false;faces[j].outside.clear();}
    int start=(int)faces.size();
    for(auto& entry:boundary){auto edge=entry.second;Face f=faceOf(edge.first,edge.second,point,pts,inner);
      if(norm(f.normal)<EPS)return false;faces.push_back(std::move(f));}
    if(start==(int)faces.size())return false;
    for(int i:reassess){if(i==point)continue;double maxD=EPS;int owner=-1;
      for(int j=start;j<(int)faces.size();++j){double gap=distance(faces[j],pts[i],pts);if(gap>maxD){maxD=gap;owner=j;}}
      if(owner>=0)faces[owner].outside.push_back(i);
    }
    if(iteration==19999)return false;
  }
  std::unordered_map<int,uint32_t> remap;
  for(const Face& f:faces)if(f.alive){
    for(int index:{f.a,f.b,f.c}){
      auto it=remap.find(index);
      if(it==remap.end()){uint32_t id=(uint32_t)(hullPositions.size()/3);remap[index]=id;
        hullPositions.push_back((float)pts[index].x);hullPositions.push_back((float)pts[index].y);hullPositions.push_back((float)pts[index].z);
        hullIndices.push_back(id);
      }else hullIndices.push_back(it->second);
    }
    hullVolume+=dot(pts[f.a],cross(pts[f.b],pts[f.c]))/6.0;
  }
  hullVolume=std::abs(hullVolume);
  return hullVolume>EPS;
}

struct EigenSystem {std::array<double,3> values;std::array<double,9> vectors;};
EigenSystem eigenSystem(double m[3][3]){
  double axes[3][3]={{1,0,0},{0,1,0},{0,0,1}};
  for(int step=0;step<40;++step){
    int p=0,q=1;double biggest=std::abs(m[0][1]);
    for(int i=0;i<3;++i)for(int j=i+1;j<3;++j)if(std::abs(m[i][j])>biggest){biggest=std::abs(m[i][j]);p=i;q=j;}
    if(biggest<1e-12)break;
    double angle=0.5*std::atan2(2*m[p][q],m[q][q]-m[p][p]);
    double cs=std::cos(angle),sn=std::sin(angle);
    double app=m[p][p],aqq=m[q][q],apq=m[p][q];
    m[p][p]=cs*cs*app-2*cs*sn*apq+sn*sn*aqq;
    m[q][q]=sn*sn*app+2*cs*sn*apq+cs*cs*aqq;
    m[p][q]=m[q][p]=0;
    for(int k=0;k<3;++k)if(k!=p&&k!=q){double x=m[k][p],y=m[k][q];m[k][p]=m[p][k]=cs*x-sn*y;m[k][q]=m[q][k]=sn*x+cs*y;}
    for(int k=0;k<3;++k){double x=axes[k][p],y=axes[k][q];axes[k][p]=cs*x-sn*y;axes[k][q]=sn*x+cs*y;}
  }
  std::array<int,3> order={0,1,2};std::sort(order.begin(),order.end(),[&](int a,int b){return m[a][a]>m[b][b];});
  EigenSystem result{};
  for(int i=0;i<3;++i){result.values[i]=m[order[i]][order[i]];
    for(int j=0;j<3;++j)result.vectors[i*3+j]=axes[j][order[i]];}
  return result;
}
}
extern "C" {
int geom_analyze(const float* positions,int vertexCount,const uint32_t* indices,int indexCount){
  values.fill(0);hullPositions.clear();hullIndices.clear();
  if(!positions||!indices||vertexCount<4||indexCount<12||indexCount%3)return 1;
  std::vector<V> pts;pts.reserve(vertexCount);
  V lo={1e100,1e100,1e100},hi={-1e100,-1e100,-1e100};
  for(int i=0;i<vertexCount;++i){V p={positions[3*i],positions[3*i+1],positions[3*i+2]};
    if(!std::isfinite(p.x)||!std::isfinite(p.y)||!std::isfinite(p.z))return 1;
    pts.push_back(p);lo={std::min(lo.x,p.x),std::min(lo.y,p.y),std::min(lo.z,p.z)};
    hi={std::max(hi.x,p.x),std::max(hi.y,p.y),std::max(hi.z,p.z)};
  }
  // 表示用に重複した頂点を位置で統合し、各辺が逆向きの2面に共有されるか確かめる。
  std::map<std::tuple<long long,long long,long long>,int> uniqueIds;
  std::vector<int> canonical(vertexCount);
  for(int i=0;i<vertexCount;++i){auto key=std::make_tuple(std::llround(pts[i].x*1e6),std::llround(pts[i].y*1e6),std::llround(pts[i].z*1e6));
    auto found=uniqueIds.find(key);if(found==uniqueIds.end()){int next=(int)uniqueIds.size();uniqueIds[key]=next;canonical[i]=next;}
    else canonical[i]=found->second;}
  std::map<std::pair<int,int>,std::pair<int,int>> edgeUse;
  for(int i=0;i<indexCount;i+=3){int ids[3];
    for(int k=0;k<3;++k){if(indices[i+k]>=(uint32_t)vertexCount)return 1;ids[k]=canonical[indices[i+k]];}
    if(ids[0]==ids[1]||ids[1]==ids[2]||ids[2]==ids[0])return 2;
    for(int k=0;k<3;++k){int a=ids[k],b=ids[(k+1)%3];auto& usage=edgeUse[std::minmax(a,b)];
      usage.first++;usage.second+=a<b?1:-1;}
  }
  for(const auto& edge:edgeUse)if(edge.second.first!=2||edge.second.second!=0)return 2;
  double extent=std::max({hi.x-lo.x,hi.y-lo.y,hi.z-lo.z});if(extent<EPS)return 2;
  // 入力方式に関係なく最長軸を1に正規化する。
  for(V& p:pts)p=p*(1.0/extent);
  lo=lo*(1.0/extent);hi=hi*(1.0/extent);
  double signedVolume=0,area=0,mom[3]={},second[3][3]={};
  for(int i=0;i<indexCount;i+=3){
    uint32_t ia=indices[i],ib=indices[i+1],ic=indices[i+2];if(ia>=pts.size()||ib>=pts.size()||ic>=pts.size())return 1;
    V a=pts[ia],b=pts[ib],c=pts[ic];double v=dot(a,cross(b,c))/6.0;
    area+=norm(cross(b-a,c-a))*0.5;signedVolume+=v;
    double coords[3][3]={{a.x,a.y,a.z},{b.x,b.y,b.z},{c.x,c.y,c.z}};
    for(int k=0;k<3;++k){mom[k]+=v*(coords[0][k]+coords[1][k]+coords[2][k])/4;
      for(int l=0;l<3;++l){double sum=0;
        for(int u=0;u<3;++u)for(int w=0;w<3;++w)sum+=coords[u][k]*coords[w][l]*(u==w?2:1);
        second[k][l]+=v*sum/20;
      }
    }
  }
  if(std::abs(signedVolume)<EPS||area<EPS)return 2;
  double center[3]={mom[0]/signedVolume,mom[1]/signedVolume,mom[2]/signedVolume};
  double cov[3][3];for(int k=0;k<3;++k)for(int l=0;l<3;++l)cov[k][l]=second[k][l]/signedVolume-center[k]*center[l];
  auto system=eigenSystem(cov);auto eig=system.values;
  double volume=std::abs(signedVolume),hullVolume=0;
  if(!quickHull(pts,hullVolume))return 2;
  double bbox=(hi.x-lo.x)*(hi.y-lo.y)*(hi.z-lo.z);
  double e=eig[0]>EPS?1-std::sqrt(std::max(0.0,(eig[1]+eig[2])/(2*eig[0]))):0;
  double q=1-std::cbrt(PI)*std::pow(6*volume,2.0/3.0)/area;
  double inertia[3]={volume*(eig[1]+eig[2]),volume*(eig[0]+eig[2]),volume*(eig[0]+eig[1])};
  values={volume,area,center[0],center[1],center[2],inertia[0],inertia[1],inertia[2],
    clamp01(e),clamp01(volume/hullVolume),clamp01(q),bbox>EPS?clamp01(volume/bbox):0,
    system.vectors[0],system.vectors[1],system.vectors[2],system.vectors[3],system.vectors[4],system.vectors[5],
    system.vectors[6],system.vectors[7],system.vectors[8]};
  return 0;
}
double geom_value(int index){return index>=0&&index<(int)values.size()?values[index]:0;}
const float* geom_hull_positions(){return hullPositions.data();}
const uint32_t* geom_hull_indices(){return hullIndices.data();}
int geom_hull_vertex_count(){return (int)hullPositions.size()/3;}
int geom_hull_index_count(){return (int)hullIndices.size();}
}
